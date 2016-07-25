/**
  * Author:       Miguel Santamaria
  * Date:         13.06.2016
  * Description:  This controller contains all the actions related to the search of Tweets through the Twitter's APIs.
  *               The user must be connected to access these actions.
  */

package controllers

import java.io.{File, FileWriter}
import java.util.Date
import javax.inject._
import akka.actor._
import akka.stream.Materializer
import com.typesafe.config.ConfigFactory
import play.api.{Configuration, Environment}
import play.api.cache.CacheApi
import play.api.libs.json._
import play.api.mvc._
import play.api.libs.streams._
import play.twirl.api.TemplateMagic.javaCollectionToScala
import twitter4j._
import scala.collection.mutable.ListBuffer
import scala.concurrent.Future
import scala.io.Source
import scala.util.control.Breaks._

/**
  * This controller creates an `Action` to handle HTTP requests to the application's search page.
  *
  * @param system used by the WebSocket system's actors.
  * @param materializer used by the WebSocket system's actors.
  * @param cache the cache object used to access the server's cache.
  * @param configuration the configuration object used to access the server's configuration.
  * @param environment the environment of the application, used to get its absolute path in order to write files.
  */
@Singleton
class SearchController @Inject() (implicit system: ActorSystem, materializer: Materializer, cache: CacheApi,
                                  configuration: Configuration, environment: Environment) extends Controller {
  val CONFIG = ConfigFactory.load("twitter.conf")
  // Will be used to validate and format the Tweets' date and time formats.
  val DATE_FORMAT = new java.text.SimpleDateFormat("yyyy-MM-dd")
  val DATE_TIME_FORMAT = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss")
  // Contains the path of the GeoTwit's "tmp" file, in which backup files will be saved.
  val BASE_FILE_PATH: String = environment.rootPath + "/tmp/"
  // Strings used in the backup file.
  val METADATA_STRING = "METADATA:"
  val FIRST_SUBJECT_STRING = "FIRST_SUBJECT:"
  val SECOND_SUBJECT_STRING = "SECOND_SUBJECT:"
  val LANGUAGE_STRING = "LANGUAGE:"
  val COORDINATES_STRING = "COORDINATES:"
  val TWEETS_STRING = "TWEETS:"
  val RESULTS_STRING = "RESULTS:"
  val ELAPSED_TIME_STRING = "ELAPSED_TIME:"
  val TOTAL_RECEIVED_GEOLOCATED_TWEETS_STRING = "GTRT:"
  val RECEPTION_OF_GEOLOCATED_TWEETS_STRING = "GRT:"
  val PART_RECEIVED_GEOLOCATED_TWEETS_BY_SUBJECT_STRING = "GPRT:"
  val TOTAL_RECEIVED_TWEETS_STRING = "ATRT:"
  val RECEPTION_OF_TWEETS_STRING = "ART:"
  val TWEETS_WITH_VS_WITHOUT_GEOLOC_STRING = "AGVW:"

  /**
    * Represents an actions composition, which can be interpreted like a generic action functionality.
    * This actions composition checks if the user is connected when he tries to access an action of this controller. If
    * not, it redirects the user to the Home page.
    * This acts like a filter, but for specific actions.
    *
    * More information about composition here: https://www.playframework.com/documentation/2.2.x/ScalaActionsComposition
    */
  object AuthenticatedAction extends ActionBuilder[Request] {
    // The invokeBlock method is called for every action built by the ActionBuilder.
    def invokeBlock[A](request: Request[A], block: (Request[A]) => Future[Result]) = {
      // If the current user if correctly authenticated, gives the control to the current action.
      if (isUserAuthenticated(request)) {
        block(request)
      // Otherwise redirects the user to the Logout page (to ensure everything is properly cleaned).
      } else {
        Future.successful(Redirect(routes.HomeController.logout).flashing(
          "error" -> "sessionExpired"
        ))
      }
    }
  }

  /**
    * Instantiates a new WebSocket's actor, used for the Twitter's streaming process.
    */
  object StreamingSocketActor {
    def props(out: ActorRef, id: String) = {
      Props(new StreamingSocketActor(out, id))
    }
  }

  /**
    * Represents a WebSocket's actor, used for the Twitter's streaming process.
    *
    * @param out the output string message sent to the client.
    * @param id the current session's unique ID
    */
  class StreamingSocketActor(out: ActorRef, id: String) extends Actor {
    var elapsedTime = "00:00:00"
    var gtrt, grt, atrt, art, agvw = "[[],[]]"
    var gprt = "[]"
    // Indicates if the server was able to write the file for the first Tweet (in order to avoid getting an error for
    // each Tweet).
    var canCreateFile = true

    // Sends a successful initialization's status as soon as the connection has been established.
    out ! JsObject(Seq("messageType" -> JsString("successfulInit")))

    // Instantiates the first Twitter's stream object used to work with the Streaming API and starts the first
    // streaming.
    // If the user entered a second keywords set, a second streaming will be started.
    var twitterStreams: ListBuffer[TwitterStream] = ListBuffer(new TwitterStreamFactory().getInstance())

    /**
      * Occurs when the web socket server received a new Json message from the client.
      */
    def receive = {
      case data: JsValue =>
        // Searchs for the received message's type.
        (data \ "messageType").validate[String] match {
          // Occurs when the client successfully displayed the result components and asked the server to begin the
          // stream.
          case JsSuccess("readyToStream", _) => {
            println("Yay, ready to stream!")
            val isAreaRectangleVal = (data \ "isAreaRectangle").validate[Boolean]
            val firstKeywords = (data \ "firstKeywords").validate[String]
            val secondKeywords = (data \ "secondKeywords").validate[String]
            val coordinates = (data \ "coordinates").validate[Array[Array[Double]]]
            val language = (data \ "language").validate[String]

            (isAreaRectangleVal, firstKeywords, secondKeywords, coordinates, language) match {
              case (JsSuccess(rec, _), JsSuccess(fk, _), JsSuccess(sk, _), JsSuccess(c, _), JsSuccess(l, _)) => {
                // Gets the cached Twitter object, which will be used to correctly configure the Twitter's stream
                // object.
                val getTwitter = cache.get[Twitter](id + "-twitter")

                getTwitter match {
                  // If the Twitter object no longer exists, the session expired so the user has to be disconnected.
                  case None => {
                    out ! JsObject(Seq(
                      "messageType" -> JsString("stopStreaming"),
                      "reason"      -> JsString("sessionExpired")
                    ))

                    // Kills the actor in charge of the current client. This will also stop the current streaming
                    // process.
                    out ! PoisonPill
                  }
                  case Some(twitter) => {
                    // Writes the metadata at the beginning of the backup file.
                    val metadata =
                      FIRST_SUBJECT_STRING + fk + (if (!sk.isEmpty) "\r\n" + SECOND_SUBJECT_STRING + sk else "") +
                      "\r\n" + LANGUAGE_STRING + (if (l.isEmpty) "ANY" else l) + "\r\n" + COORDINATES_STRING + "[" +
                      c.map(coord => "[" + coord.mkString(",") + "]").mkString(",") + "]"
                    writeInFile(
                      "streaming-" + id + ".gt", METADATA_STRING + "\r\n" + metadata + "\r\n" + TWEETS_STRING + "\r\n"
                    )

                    // Sets the Twitter's Stream object with the Twitter object's configuration.
                    twitterStreams(0).setOAuthConsumer(
                      CONFIG.getString("twitter4j.oauth.consumerKey"),
                      CONFIG.getString("twitter4j.oauth.consumerSecret")
                    )
                    twitterStreams(0).setOAuthAccessToken(twitter.getOAuthAccessToken)

                    streaming(out, twitterStreams(0), id, rec, "first", fk, c(0), c(2), l)

                    // Starts a second streaming process if the second keywords set is set.
                    if (!sk.isEmpty) {
                      // Creates a new Twitter's stream object.
                      twitterStreams += (new TwitterStreamFactory().getInstance())
                      // Sets the new Twitter's Stream object with the Twitter object's configuration.
                      twitterStreams(1).setOAuthConsumer(
                        CONFIG.getString("twitter4j.oauth.consumerKey"),
                        CONFIG.getString("twitter4j.oauth.consumerSecret")
                      )
                      twitterStreams(1).setOAuthAccessToken(twitter.getOAuthAccessToken)

                      streaming(out, twitterStreams(1), id, rec, "second", sk, c(0), c(2), l)
                    }
                  }
                }
              }
              case _ => println("I received a bad-formatted socket.")
            }
          }
          // Occurs when the client sent a confirmation that the received Tweet belongs to the country's territories, if
          // the user selected a country in the drop-down menu.
          case JsSuccess("tweetLocationConfirmation", _) => {
            if (canCreateFile) {
              val keywordsSet = (data \ "keywordsSet").validate[String]
              val internalId = (data \ "internalId").validate[Int]
              val creationDate = (data \ "creationDate").validate[String]
              val longitude = (data \ "longitude").validate[Double]
              val latitude = (data \ "latitude").validate[Double]
              val user = (data \ "user").validate[String]
              val content = (data \ "content").validate[String]

              (keywordsSet, internalId, creationDate, longitude, latitude, user, content) match {
                case (
                  JsSuccess(k, _), JsSuccess(tweetInternalId, _), JsSuccess(d, _), JsSuccess(lon, _), JsSuccess(lat, _),
                  JsSuccess(u, _), JsSuccess(c, _)
                ) => {
                  canCreateFile = writeTweetInFile(out, id, k, tweetInternalId, d, lon, lat, u, c)
                }
                case _ => println("I received a bad-formatted socket.")
              }
            }
          }
          // Occurs when the client sent the current charts' results and the elapsed time.
          case JsSuccess("currentResults", _) => {
            val elapsedTimeVal = (data \ "elapsedTime").validate[String]
            val gtrtVal = (data \ "gtrt").validate[String]
            val grtVal = (data \ "grt").validate[String]
            val gprtVal = (data \ "gprt").validate[String]
            val atrtVal = (data \ "atrt").validate[String]
            val artVal = (data \ "art").validate[String]
            val agvwVal = (data \ "agvw").validate[String]

            // Saves the current results if they are valid.
            (elapsedTimeVal, gtrtVal, grtVal, gprtVal, atrtVal, artVal, agvwVal) match {
              case (
                JsSuccess(e, _), JsSuccess(g1, _), JsSuccess(g2, _), JsSuccess(g3, _), JsSuccess(g4, _),
                JsSuccess(g5, _), JsSuccess(g6, _)
              ) => {
                elapsedTime = e
                gtrt = g1
                grt = g2
                gprt = g3
                atrt = g4
                art = g5
                agvw = g6
              }
              case _ => println("I received a bad-formatted socket.")
            }
          }
          // Stops streaming when the user clicked on the well-named button.
          case JsSuccess("stopStreaming", _) => out ! PoisonPill
          case _ => println("I received a bad-formatted socket.")
        }
    }

    /**
      * Stops the currents streamings if the socket is destroyed.
      */
    override def postStop() = {
      println("Got it, I am stopping the streaming process...")

      // Clears and stops each existing streaming.
      for (ts <- twitterStreams) {
        ts.clearListeners()
        ts.shutdown()
      }

      // Writes the current results at the end of the backup file.
      val results =
        ELAPSED_TIME_STRING + elapsedTime + "\r\n" + TOTAL_RECEIVED_GEOLOCATED_TWEETS_STRING + gtrt + "\r\n" +
        RECEPTION_OF_GEOLOCATED_TWEETS_STRING + grt + "\r\n" + PART_RECEIVED_GEOLOCATED_TWEETS_BY_SUBJECT_STRING +
        gprt + "\r\n" + TOTAL_RECEIVED_TWEETS_STRING + atrt + "\r\n" + RECEPTION_OF_TWEETS_STRING + art + "\r\n" +
        TWEETS_WITH_VS_WITHOUT_GEOLOC_STRING + agvw
      writeInFile("streaming-" + id + ".gt", RESULTS_STRING + "\r\n" + results)
    }
  }

  /**
    * Checks if the user is correctly authenticated and returns a boolean value.
    *
    * @param request the current HTTP request's header object.
    * @return true if the user is authenticated, false otherwise.
    */
  def isUserAuthenticated(request: RequestHeader): Boolean = {
    // Checks that the session have an unique ID.
    request.session.get("id") match {
      case Some(id) => {
        // Returns false if the user is not connected, otherwise returns true.
        (cache.get(id + "-twitter"), request.session.get("username")) match {
          case (Some(_), Some(_)) => true
          case _ => false
        }
      }
      case None => false
    }
  }

  /**
    * Writes the given string in the given file's name.
    *
    * @param fileName the name of the file in which the string will be saved
    * @param content the string value to save
    */
  def writeInFile(fileName: String, content: String) = {
    val file = new File(BASE_FILE_PATH + fileName)
    val fw = new FileWriter(file, true)

    try {
      fw.write(content)
    } finally {
      fw.close()
    }
  }

  /**
    * Validates and parses the given file in order to export its data within the application.
    * The file must be a well-formatted GeoTwit file (".gt" extension, and containing metadata, tweets and results).
    *
    * @param file the file to validate and parse
    * @return a Json object containing all the file's information or a Json object containing an error if the file was
    *         not valid.
    */
  def validateAndParseFile(file: File): JsObject = {
    // Contains the object returned in case of error.
    val errorResult = Json.obj("error" -> JsBoolean(true), "reason" -> JsString("fileNotValid"))

    try {
      // Get all the file's lines.
      val lines = Source.fromFile(file).getLines().toList

      // The first line of the file must introduce the metadata.
      if (lines(0) != METADATA_STRING) {
        errorResult
      } else {
        // Contains regular expressions in order to validate and get the metadata.
        val firstSubjectRE = (FIRST_SUBJECT_STRING + "(.+)").r
        val secondSubjectRE = (SECOND_SUBJECT_STRING + "(.+)").r
        val languageRE = (LANGUAGE_STRING + "(.+)").r
        val coordinatesRE = (COORDINATES_STRING + """\[(.+)\]""").r

        // Used to count the number of parsed lines and to get the numbers of the lines that start a new section.
        var currentLineNumber = 1
        var lineNumberTweets, lineNumberResults = 0

        // Will contain the retrieved metadata.
        var firstSubject, secondSubject, language = ""
        var coordinates: Array[Array[Double]] = Array()

        // Validates the metadata and get the sections' lines.
        breakable {
            for (line <- lines.tail) {
              currentLineNumber += 1

            line match {
              case firstSubjectRE(f)  => firstSubject = f
              case secondSubjectRE(s) => secondSubject = s
              case languageRE(l)      => language = l
              // Converts the given string into an array of arrays of double containing the search's coordinates.
              case coordinatesRE(c)   => {
                coordinates = c.drop(1).dropRight(1).split("""\],\[""")
                  .map(coord => coord.split(",").map(x => x.toDouble))
              }
              case TWEETS_STRING      => lineNumberTweets = currentLineNumber
              // Stops the loop once the last section's title was found.
              case RESULTS_STRING     => {
                lineNumberResults = currentLineNumber
                break
              }
              case _                  => {}
            }
          }
        }

        // Ensures the metadata are valid and all the sections exist before reading the Tweets and the results.
        if (firstSubject.nonEmpty && language.nonEmpty && coordinates.length > 0 && lineNumberTweets > 0 &&
          lineNumberResults > 0) {
          // Regular expression used to validate a Tweet entry and get its data.
          val tweetRE = ("((?>first|second)-subject#\\d+);(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2});(-?\\d+\\.?\\d" +
            "*);(-?\\d+\\.?\\d*);\"(.+)\";\"(.+)\"").r
          var error = false

          // Iterates over each Tweet.
          val values = lines.take(lineNumberResults - 1).drop(lineNumberTweets).map(
            t => t match {
              // Validates the current Tweet's format and gets its data.
              case tweetRE(sub, date, long, lat, user, content) => {
                Json.obj(
                  "subjectIdentifier" -> JsString(sub.substring(0, t.indexOf('-'))),
                  "dateAndTime" -> JsString(date),
                  "longitude" -> JsNumber(long.toDouble),
                  "latitude" -> JsNumber(lat.toDouble),
                  "user" -> JsString(user),
                  "content" -> JsString(content)
                )
              }
              // Indicates that an error occurred if the Tweet is not valid.
              case _ => {
                error = true
                Json.obj()
              }
            }
          )

          if (error) {
            errorResult
          } else {
            // Regular expressions used to validate and get the results.
            val elapsedTimeRE = (ELAPSED_TIME_STRING + "(.+)").r
            val gtrtRE = (TOTAL_RECEIVED_GEOLOCATED_TWEETS_STRING + """\[(.+)\]""").r
            val grtRE = (RECEPTION_OF_GEOLOCATED_TWEETS_STRING + """\[(.+)\]""").r
            val gprtRE = (PART_RECEIVED_GEOLOCATED_TWEETS_BY_SUBJECT_STRING + """(.+)""").r
            val atrtRE = (TOTAL_RECEIVED_TWEETS_STRING + """\[(.+)\]""").r
            val artRE = (RECEPTION_OF_TWEETS_STRING + """\[(.+)\]""").r
            val agvwRE = (TWEETS_WITH_VS_WITHOUT_GEOLOC_STRING + """\[(.+)\]""").r

            // Will contain all the results' values.
            var elapsedTime = ""
            var gtrt: Array[Array[Double]] = Array()
            var grt: Array[Array[Double]] = Array()
            var gprt: Array[Double] = Array()
            var atrt: Array[Array[Double]] = Array()
            var art: Array[Array[Double]] = Array()
            var agvw: Array[Array[Double]] = Array()

            // Iterates over the results in the file and collects them.
            for (line <- lines.drop(lineNumberResults)) {
              line match {
                case elapsedTimeRE(e) => elapsedTime = e
                case gtrtRE(g)        => {
                  if (g != "[[],[]]") gtrt = g.drop(1).dropRight(1).split("""\],\[""").map(dataset => dataset
                    .split(",").map(x => x.toDouble)) else gtrt = Array(Array(0.0), Array(0.0))
                }
                case grtRE(g)         => {
                  if (g != "[[],[]]") grt = g.drop(1).dropRight(1).split("""\],\[""").map(dataset => dataset.split(",")
                    .map(x => x.toDouble)) else grt = Array(Array(0.0), Array(0.0))
                }
                case gprtRE(g)        => {
                  if (g != "[]") gprt = g.drop(1).dropRight(1).split(",").map(x => x.toDouble) else gprt = Array(0.0)
                }
                case atrtRE(g)        => {
                  if (g != "[[],[]]") atrt = g.drop(1).dropRight(1).split("""\],\[""").map(dataset => dataset.split(",")
                    .map(x => x.toDouble)) else atrt = Array(Array(0.0), Array(0.0))
                }
                case artRE(g)         => {
                  if (g != "[[],[]]") art = g.drop(1).dropRight(1).split("""\],\[""").map(dataset => dataset.split(",")
                    .map(x => x.toDouble)) else art = Array(Array(0.0), Array(0.0))
                }
                case agvwRE(g)        => {
                  if (g != "[[],[]]" && g != "[[null,null],[]]") {
                    agvw = g.drop(1).dropRight(1).split("""\],\[""").map(dataset => dataset.split(",")
                      .map(x => x.toDouble))
                  } else {
                    agvw = Array(Array(0.0, 0.0), Array(0.0, 0.0))
                  }
                }
                case _                => error = true
              }
            }

            // Builds and returns the Json object if the results were valid.
            if (!error && elapsedTime.nonEmpty && gtrt.length > 0 && grt.length > 0 && gprt.length > 0 &&
              atrt.length > 0 && art.length > 0 && agvw.length > 0) {
              Json.obj(
                "error"         -> JsBoolean(false),
                "firstSubject"  -> JsString(firstSubject),
                "secondSubject" -> JsString(secondSubject),
                "language"      -> JsString(language),
                "coordinates"   -> coordinates
              ) + ("tweets" -> JsArray(values)) + ("results" -> (Json.obj(
                "elapsedTime"   -> JsString(elapsedTime),
                "gtrt"          -> gtrt,
                "grt"           -> grt,
                "gprt"          -> gprt,
                "atrt"          -> atrt,
                "art"           -> art,
                "agvw"          -> agvw
              )))
            } else {
              errorResult
            }
          }
        } else {
          errorResult
        }
      }
    } catch {
      case e: Exception => {
        e.printStackTrace()
        errorResult
      }
    }
  }

  /**
    * Writes the Tweets whose information are given in parameters in the backup file.
    *
    * @param out the actor who is in charge of the current client's web socket discussion; used to send an error to the
    *            client if the server is not able to write the file.
    * @param sessionId the unique ID of the current session
    * @param keywordsSetIdentifier the identifier of the Tweet's keywords set/subject - either "first" or "second"
    * @param internalId the internal ID of the Tweet
    * @param creationDate the creation date of the Tweet
    * @param longitude the Tweet's longitude
    * @param latitude the Tweet's latitude
    * @param user the Tweet's user
    * @param content the Tweet's content
    * @return a boolean value indicating if the Tweet was either successfully written in the file (true) or not (false).
    */
  def writeTweetInFile(out: ActorRef, sessionId: String, keywordsSetIdentifier: String, internalId: Int,
                       creationDate: String, longitude: Double, latitude: Double, user: String,
                       content: String): Boolean = {
    try {
      // Write the given Tweet in the file, by replacing each line break of the Tweet's content (in order to avoid
      // issues with the file's parsing).
      writeInFile(
        "streaming-" + sessionId + ".gt", keywordsSetIdentifier  + "-subject#" + internalId + ";" +
          creationDate + ";" + longitude + ";" + latitude + ";\"" +
          user + "\";\"" + content.filter(c => c != '\n' && c != '\r') + "\"\r\n"
      )

      true
    } catch {
      case e: Exception => {
        e.printStackTrace()
        // Sends an error message to the client if the server was not able to write the file.
        out ! JsObject(Seq("messageType" -> JsString("errorFile")))

        false
      }
    }
  }

  /**
    * Starts a new Twitter's streaming process, according to the given parameters.
    *
    * @param out the actor who is in charge of the current client's web socket discussion.
    * @param twitterStream a instantiated and configured Twitter's stream object
    * @param id the unique ID of the current session
    * @param isAreaRectangle indicates whether the user manually drew a rectangle on the map (true) or selected a
    *                        country in the drop-down menu (false); if false, this value indicates that the server must
    *                        wait for the client to send a confirmation indicating that the received Tweet is in the
    *                        complex polygon area that represents the country's territories (since the client only gave
    *                        the bounding box to the server, in order to avoid to overload the connection), in order to
    *                        only write Tweets belonging to the area in the backup file.
    * @param keywordsSetIdentifier indicates the keywords set ("first" or "second") for which the current streaming
    *                              process will  be, so the client can display Tweet with different colors.
    * @param query the query used to filter the streaming of Tweets
    * @param southwestCoordinates the southwest coordinate of the selected area's bounding rectangle, as a "longitude,
    *                             latitude" format.
    * @param northeastCoordinates the northeast coordinate of the selected area's bounding rectangle, as a "longitude,
    *                             latitude" format.
    * @param language a English-written language used to filter Tweets; if this parameter is empty, there won't be a
    *                 language filter.
    */
  def streaming(out: ActorRef, twitterStream: TwitterStream, id: String, isAreaRectangle: Boolean,
                keywordsSetIdentifier: String, query: String, southwestCoordinates: Array[Double],
                northeastCoordinates: Array[Double], language: String) = {
    // Geolocated Tweets' counter.
    var nbGeolocatedTweets = 0
    // Indicates if the server was able to write the file for the first Tweet (in order to avoid getting an error for
    // each Tweet).
    var canCreateFile = true
    println("Starting " + keywordsSetIdentifier + " streaming: \"" + query + "\" written in " + (if (language.isEmpty)
      "any language" else "\"" + language + "\"") + ".")
    // Contains the total number of received Tweets (with or without geolocation tags.)
    var numberOfReceivedTweets = 0

    // Initializes a listener that will listen to the Twitter's streaming and react by the received type of message.
    val listener: StatusListener = new StatusListener {
      /**
        * Occurs when the listener received a new Tweet from the Twitter's API.
        * Checks if the received Tweet has a geolocation tag, and if so, sends a new web socket to the client in
        * order to inform it.
        *
        * @param status the new Tweet's data
        */
      override def onStatus(status: twitter4j.Status): Unit = {
        val geoLocation: GeoLocation = status.getGeoLocation
        numberOfReceivedTweets += 1

        if (geoLocation != null) {
          val longitude: Double = geoLocation.getLongitude
          val latitude: Double = geoLocation.getLatitude

          // Sends a web socket to the client if the received Tweet is located into the given coordinates.
          if (longitude >= southwestCoordinates(0) && longitude <= northeastCoordinates(0) &&
            latitude >= southwestCoordinates(1) && latitude <= northeastCoordinates(1)) {

            nbGeolocatedTweets += 1

            // If the user manually drew a rectangle area, directly writes the Tweet in the backup file, (otherwise we
            // must wait for the client's "tweetLocationConfirmation" web socket.
            if (isAreaRectangle && canCreateFile) {
              canCreateFile = writeTweetInFile(out, id, keywordsSetIdentifier, nbGeolocatedTweets, DATE_TIME_FORMAT
                .format(status.getCreatedAt), longitude, latitude, status.getUser.getName, status.getText)
            }

            out ! JsObject(Seq(
              "messageType"       -> JsString("newTweet"),
              "keywordsSet"       -> JsString(keywordsSetIdentifier),
              "internalId"        -> JsNumber(nbGeolocatedTweets),
              "creationDate"      -> JsString(DATE_TIME_FORMAT.format(status.getCreatedAt)),
              "longitude"         -> JsNumber(longitude),
              "latitude"          -> JsNumber(latitude),
              "user"              -> JsString(status.getUser.getName),
              "content"           -> JsString(status.getText),
              "nbReceivedTweets"  -> JsNumber(numberOfReceivedTweets)
            ))
          }
        }
      }

      override def onStallWarning(warning: StallWarning): Unit = {}

      override def onDeletionNotice(statusDeletionNotice: StatusDeletionNotice): Unit = {}

      override def onScrubGeo(userId: Long, upToStatusId: Long): Unit = {}

      override def onTrackLimitationNotice(numberOfLimitedStatuses: Int): Unit = {}

      override def onException(ex: Exception): Unit = {
        try {
          val twitterException = ex.asInstanceOf[TwitterException].getStatusCode

          // The user ran too many copies of the same application authenticating with the same account name.
          twitterException match {
            case 420 => {
              out ! JsObject(Seq(
                "messageType" -> JsString("stopStreaming"),
                "reason"      -> JsString("tooManyStreamingProcesses")
              ))
            }
            case 406 => {
              out ! JsObject(Seq(
                "messageType" -> JsString("stopStreaming"),
                "reason"      -> JsString("queryTooLong")
              ))
            }
            case _ => ex.printStackTrace()
          }
        }
        catch {
          case e: Exception => ex.printStackTrace()
        }
        finally {
          // Stops the streaming process.
          out ! PoisonPill
        }
      }
    }

    // Starts streaming with the given filter.
    val fq: FilterQuery = new FilterQuery(query)

    // Add a language filter is the given parameter is not empty
    if (!language.isEmpty) {
      fq.language(language)
    }

    twitterStream.addListener(listener)
    twitterStream.filter(fq)
  }

  /**
    * Collects the Tweets associated to the given query with the given Twitter object.
    *
    * @param twitter the Twitter object with which the query will be executed and the results collected
    * @param query the query used to collect the results
    * @param keywordsSetIdentifier the identifier of the search's subject - either "first" or "second"
    * @param maximumNumberOfRequests - the maximum number of requests the method can do without having a Twitter's
    *                                limiation error.
    * @return a Json array containing all the Tweets
    */
  def getStaticTweets(twitter: Twitter, query: Query, keywordsSetIdentifier: String,
                      maximumNumberOfRequests: Int): JsArray = {
    // Copies the given query's parameters in a current query object, in order to be able to reset these parameters from
    // the given query for each new request (because we need to change the ID from which the new search will be
    // operated when searching for a subject with a lot of results, and we don't want to set all query's parameters
    // again).
    var currentQuery: Query = query
    var tweets: List[twitter4j.Status] = Nil
    var results: QueryResult = null
    var numberOfRequestsMade = 0
    var minId = Long.MaxValue

    try {
      // Since the number of Tweets is limited to a maximum of 100 per page, we have to execute several query, but
      // since one request is executed per query and since the number of queries is limited to approximately 170, the
      // number of results is also limited.
      // Iterates over the requests.
      do {
        results = twitter.search(currentQuery)
        numberOfRequestsMade += 1

        // Iterates over the current results' pages.
        // Since there can be a lot of results, the Twitter's API send us Tweets by page, so we have to browse
        // all pages in order to get all results.
        do {
          // If there are results, concatenates them to the current results' list.
          if (results.getTweets.size() > 0) {
            tweets ++= results.getTweets
          }

          // Gets the next page.
          currentQuery = results.nextQuery()

          if (numberOfRequestsMade < maximumNumberOfRequests && currentQuery != null) {
            results = twitter.search(currentQuery)
            numberOfRequestsMade += 1
          }
        } while (numberOfRequestsMade < maximumNumberOfRequests && currentQuery != null)

        if (numberOfRequestsMade < maximumNumberOfRequests) {
          // Get the minimum ID of the collected Tweets, in order to make a new request from this ID.
          tweets.foreach(s => if (s.getId < minId) minId = s.getId)
          // Resets the query's parameters, set the minimum ID and start the new search.
          currentQuery = query
          currentQuery.setMaxId(minId - 1)
        }
      } while (numberOfRequestsMade < maximumNumberOfRequests && results.getTweets.size() > 0)
    } catch {
      case ex: TwitterException => throw ex
      case e: Exception => throw e
    }

    JsArray(tweets.map(
      status => Json.obj(
        "subjectNumber" -> JsString(keywordsSetIdentifier),
        "date"          -> JsString(DATE_TIME_FORMAT.format(status.getCreatedAt)),
        "user"          -> JsString(status.getUser.getScreenName),
        "latitude"      -> JsNumber(if (status.getGeoLocation != null) status.getGeoLocation.getLatitude else 0),
        "longitude"     -> JsNumber(if (status.getGeoLocation != null) status.getGeoLocation.getLongitude else 0),
        "content"       -> JsString(status.getText)
      )
    ))
  }

  /**
    * Displays the Search page, allowing a user to search Tweets with the Twitter's APIs.
    * The user must be connected to access this action.
    */
  def index = AuthenticatedAction { request =>
    Ok(views.html.search(request.session.get("username").get)(request))
  }

  /**
    * Gets the file containing the last streaming's results and either downloads or deletes it, depending on the given
    * parameter. Returns a BadRequest result if the file or the given action do not exist.
    * The user must be connected to access this action.
    *
    * @param action the string representing the action to do with the file - either "download" or "delete"
    */
  def fileAction(action: String, firstSubject: Option[String],
                 secondSubject: Option[String]) = AuthenticatedAction { request =>
    // Gets the file to either download or delete.
    val file = new File(BASE_FILE_PATH + "streaming-" + request.session.get("id").get + ".gt")
    var fileName = ""

    // Sets the output file's name, according to the given parameters.
    if (firstSubject.nonEmpty) {
      fileName += firstSubject.get

      if (secondSubject.nonEmpty && secondSubject.get.nonEmpty) {
        fileName += "_" + secondSubject.get
      }

      fileName += "_"
    }

    fileName += "STREAMING_" + DATE_TIME_FORMAT.format(new Date()) + ".gt"

    // Checks if the file exists.
    if (file.exists() && !file.isDirectory()) {
      // Then downloads or deletes it, depending on the action.
      action match {
        case "download" => {
          // The file to download will be named "[SUBJECT1]_[SUBJECT2]_STREAMING_[DATETIME].gt" for the user and won't
          // be served as an inline file (inline => display of the file directly in the web browser).
          // The "Set-Cookie" header is used by the "jquery.fileDownload" in order to know that the file was
          // successfully downloaded.
          Ok.sendFile(
            content = file,
            fileName = _ => fileName,
            inline = false
          ).withHeaders("Set-Cookie" -> "fileDownload=true; path=/")
        }
        case "delete" => {
          file.delete()
          Ok("File successfully deleted.")
        }
        case _ => {
          BadRequest("This action is unknown.")
        }
      }
    } else {
      Ok("The file you are trying to access does not exist anymore.")
    }
  }

  /**
    * Parses and validates the uploaded file.
    */
    def uploadAndParseFile = AuthenticatedAction(parse.multipartFormData) { request =>
    request.body.file("importedFile").map { file =>
      // The file cannot be empty
      if (file.ref.file.length <= 0) {
        Ok(Json.obj("error" -> JsBoolean(true), "reason" -> JsString("fileEmpty")))
      // The file must be a text file.
      } else if (file.contentType.isEmpty || file.contentType.get != "application/octet-stream") {
        Ok(Json.obj("error" -> JsBoolean(true), "reason" -> JsString("wrongFormat")))
      // Validate and parses the file.
      } else {
        Ok(validateAndParseFile(file.ref.file))
      }
    }.getOrElse {
      Ok(Json.obj("error" -> JsBoolean(true), "reason" -> JsString("missingFile")))
    }
  }

  /**
    * Opens a WebSocket's connection (through the internal "StreamingSocketActor" class) between a new server's actor
    * (thread) and the client when this one accesses this entity; this connection receives and sends Json values.
    *
    * @return the flow of the new WebSocket's actor if the user is authenticated, or a bad request status otherwise.
    */
  def streamingSocket = WebSocket.acceptOrResult[JsValue, JsValue] { request =>
    Future.successful(isUserAuthenticated(request) match {
      // Creates a new web socket's actor (thread) if the user is authenticated, by passing it the current session's
      // unique ID.
      case true => Right(ActorFlow.actorRef(out => StreamingSocketActor.props(out, request.session.get("id").get)))
      case false => Left(Forbidden("sessionExpired"))
    })
  }

  /**
    * Gets and returns the results of the static mode's search, when the user pressed the "View Results" of the "Static
    * Mode" tab in the Search page.
    */
  def staticResults = AuthenticatedAction { request =>
    // Checks if the user is connected before continuing.
    if (isUserAuthenticated(request)) {
      // Indicates the maximum number of requests the user can make before having a Twitter's error.
      val MAXIMUM_NUMBER_OF_REQUESTS = 170

      var firstKeywords, secondKeywords, language = ""
      var latitude, longitude, radius = 0.0
      var fromDate, toDate = new java.util.Date()

      // Tries to get and convert the received user's parameters.
      try {
        // Tries to gets string-formatted parameters.
        firstKeywords = request.queryString.get("firstKeywords").flatMap(_.headOption).get
        secondKeywords = request.queryString.get("secondKeywords").flatMap(_.headOption).get
        language = request.queryString.get("language").flatMap(_.headOption).get
        // Tries to get date-formatted parameters.
        fromDate = DATE_FORMAT.parse(request.queryString.get("fromDate").flatMap(_.headOption).get)
        toDate = DATE_FORMAT.parse(request.queryString.get("toDate").flatMap(_.headOption).get)
        // Tries to get the double-formatted parameters.
        latitude = request.queryString.get("locationLat").flatMap(_.headOption).get.toDouble
        longitude = request.queryString.get("locationLon").flatMap(_.headOption).get.toDouble
        radius = request.queryString.get("locationRad").flatMap(_.headOption).get.toDouble
      } catch {
        // If an error occurred, it means that at least one of the parameters is not properly formatted.
        case e: Exception => Ok(JsObject(Seq("error" -> JsString("fieldsFormat"))))
      }

      // Validates the user's parameters.
      (firstKeywords, language, fromDate, toDate, latitude, longitude, radius) match {
        // The first keywords set must be set, the "to" date must be greater than the "from" one, and the radius must be
        // a positive double.
        case (fk, lan, fd, td, lat, lng, rad) if !fk.isEmpty && fd.before(td) && radius > 0 => {
          // Gets the cached Twitter object, which will be used to make the request.
          val getTwitter = cache.get[Twitter](request.session.get("id").get + "-twitter")

          getTwitter match {
            // If the Twitter object no longer exists, the session expired so the user has to be disconnected.
            case None => Ok(JsObject(Seq("error" -> JsString("sessionExpired"))))
            // Otherwise get the static Tweets.
            case Some(twitter) => {
              // Creates the query, according to the user's parameters.
              val query: Query = new Query(fk)
              query.setCount(100)
              query.setSince(DATE_FORMAT.format(fd))
              query.setUntil(DATE_FORMAT.format(td))
              query.geoCode(new GeoLocation(lat, lng), rad, "km")
              if (!lan.isEmpty) {
                query.setLang(lan)
              }

              // If the user only set one keywords set, sends the results
              if (secondKeywords.isEmpty) {
                try {
                  Ok(JsObject(Seq(
                    "first" -> getStaticTweets(twitter, query, "first", MAXIMUM_NUMBER_OF_REQUESTS)
                  )))
                } catch {
                  case ex: TwitterException => {
                    ex.getStatusCode match {
                      // The user ran too many copies of the same application authenticating with the same account name.
                      case 429 => Ok(JsObject(Seq("error" -> JsString("tooManyRequests"))))
                      case _ => {
                        ex.printStackTrace()
                        Ok(JsObject(Seq("error" -> JsString("error"))))
                      }
                    }
                  }
                  case e: Exception => {
                    e.printStackTrace()
                    Ok(JsObject(Seq("error" -> JsString("error"))))
                  }
                }
              // Otherwise collects the Tweets linked to the second stream and sends the Tweets of both subjects to the
              // client.
              } else {
                // Create the second query.
                val secondQuery: Query = new Query(secondKeywords)
                secondQuery.setCount(100)
                secondQuery.setSince(DATE_FORMAT.format(fd))
                secondQuery.setUntil(DATE_FORMAT.format(td))
                secondQuery.geoCode(new GeoLocation(lat, lng), rad, "km")
                if (!lan.isEmpty) {
                  secondQuery.setLang(lan)
                }

                try {
                  Ok(JsObject(Seq(
                    "first" -> getStaticTweets(twitter, query, "first", MAXIMUM_NUMBER_OF_REQUESTS / 2),
                    "second" -> getStaticTweets(twitter, secondQuery, "second", MAXIMUM_NUMBER_OF_REQUESTS / 2)
                  )))
                } catch {
                  case ex: TwitterException => {
                    ex.getStatusCode match {
                      // The user ran too many copies of the same application authenticating with the same account name.
                      case 429 => Ok(JsObject(Seq("error" -> JsString("tooManyRequests"))))
                      case _ => {
                        ex.printStackTrace()
                        Ok(JsObject(Seq("error" -> JsString("error"))))
                      }
                    }
                  }
                  case e: Exception => {
                    e.printStackTrace()
                    Ok(JsObject(Seq("error" -> JsString("error"))))
                  }
                }
              }
            }
          }
        }
        case _ => Ok(JsObject(Seq("error" -> JsString("fieldEmptyOrNotValid"))))
      }
    // Sends an error message to the client if the user is no longer (or not at all) connected.
    } else {
      Ok(JsObject(Seq("error" -> JsString("sessionExpired"))))
    }
  }
}
