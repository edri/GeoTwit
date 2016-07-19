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
import play.api.libs.iteratee.Enumerator
import play.api.libs.json._
import play.api.mvc._
import play.api.libs.streams._
import play.twirl.api.TemplateMagic.javaCollectionToScala
import twitter4j._

import scala.collection.mutable.ListBuffer
import scala.concurrent.{ExecutionContext, Future}

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
class SearchController @Inject() (implicit system: ActorSystem, materializer: Materializer, cache: CacheApi, configuration: Configuration, environment: Environment) extends Controller {
  val config = ConfigFactory.load("twitter.conf")
  // Will be used to validate and format the Tweets' date and time formats.
  val dateFormat = new java.text.SimpleDateFormat("yyyy-MM-dd")
  val dateTimeFormat = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss")
  // Contains the path of the GeoTwit's "tmp" file, in which backup files will be saved.
  val baseFilePath: String = environment.rootPath + "/tmp/"

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
    // Sends a successful initialization's status as soon as the connection has been established.
    out ! JsObject(Seq("messageType" -> JsString("successfulInit")))

    // Instantiates the first Twitter's stream object used to work with the Streaming API and starts the first streaming.
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
            val firstKeywords = (data \ "firstKeywords").validate[String]
            val secondKeywords = (data \ "secondKeywords").validate[String]
            val coordinates = (data \ "coordinates").validate[Array[Array[Double]]]
            val language = (data \ "language").validate[String]

            (firstKeywords, secondKeywords, coordinates, language) match {
              case (JsSuccess(fk, _), JsSuccess(sk, _), JsSuccess(c, _), JsSuccess(l, _)) => {
                // Gets the cached Twitter object, which will be used to correctly configure the Twitter's stream object.
                val getTwitter = cache.get[Twitter](id + "-twitter")

                getTwitter match {
                  // If the Twitter object no longer exists, the session expired so the user has to be disconnected.
                  case None => {
                    out ! JsObject(Seq(
                      "messageType" -> JsString("stopStreaming"),
                      "reason"      -> JsString("sessionExpired")
                    ))

                    // Kills the actor in charge of the current client. This will also stop the current streaming process.
                    out ! PoisonPill
                  }
                  case Some(twitter) => {
                    // Writes the metadata at the beginning of the backup file.
                    val metadata =
                      "\tFIRST SUBJECT: \"" + fk + (if (!sk.isEmpty) "\"\r\n\tSECOND SUBJECT: \"" + sk else "") +
                      "\"\r\n\tLANGUAGE: " + (if (l.isEmpty) "ANY" else "\"" + l + "\"") + "\r\n\tCOORDINATES: [" +
                      c.map(coord => "[" + coord.mkString(", ") + "]").mkString(", ") + "]\r\n"
                    writeInFile("streaming-" + id + ".txt", "METADATA:\r\n" + metadata + "\r\nTWEETS:\r\n")

                    // Sets the Twitter's Stream object with the Twitter object's configuration.
                    twitterStreams(0).setOAuthConsumer(
                      config.getString("twitter4j.oauth.consumerKey"),
                      config.getString("twitter4j.oauth.consumerSecret")
                    )
                    twitterStreams(0).setOAuthAccessToken(twitter.getOAuthAccessToken)

                    streaming(out, twitterStreams(0), id, "first", fk, c(0), c(2), l)

                    // Starts a second streaming process if the second keywords set is set.
                    if (!sk.isEmpty) {
                      // Creates a new Twitter's stream object.
                      twitterStreams += (new TwitterStreamFactory().getInstance())
                      // Sets the new Twitter's Stream object with the Twitter object's configuration.
                      twitterStreams(1).setOAuthConsumer(
                        config.getString("twitter4j.oauth.consumerKey"),
                        config.getString("twitter4j.oauth.consumerSecret")
                      )
                      twitterStreams(1).setOAuthAccessToken(twitter.getOAuthAccessToken)

                      streaming(out, twitterStreams(1), id, "second", sk, c(0), c(2), l)
                    }
                  }
                }
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
    * @param str the string value to save
    */
  def writeInFile(fileName: String, str: String) = {
    val file = new File(baseFilePath + fileName)
    val fw = new FileWriter(file, true)

    try {
      fw.write(str)
    } finally {
      fw.close()
    }
  }

  /**
    * Starts a new Twitter's streaming, by the given parameters.
    *
    * @param out the actor who is in charge of the current client's web socket discussion.
    * @param twitterStream a instantiated and configured Twitter's stream object
    * @param id the unique ID of the current session
    * @param keywordsSet indicates the keywords set ("first" or "second") for which the current streaming process will
    *                    be, so the client can display Tweet with different colors.
    * @param query the query used to filter the streaming of Tweets
    * @param southwestCoordinates the southwest coordinate of the selected area's bounding rectangle, as a "longitude,
    *                             latitude" format.
    * @param northeastCoordinates the northeast coordinate of the selected area's bounding rectangle, as a "longitude,
    *                             latitude" format.
    * @param language a English-written language used to filter Tweets; if this parameter is empty, there won't be a
    *                 language filter.
    */
  def streaming(out: ActorRef, twitterStream: TwitterStream, id: String, keywordsSet: String, query: String,
                southwestCoordinates: Array[Double], northeastCoordinates: Array[Double], language: String) = {
    // Geolocated Tweets' counter.
    var nbGeolocatedTweets = 0
    // Indicates if the server could write the file for the first Tweet (in order to get an error for each Tweet).
    var cantCreateFile = false
    println("Starting " + keywordsSet + " streaming: \"" + query + "\" written in " + (if (language.isEmpty) "any language" else "\"" + language + "\"") + ".")
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

            if (!cantCreateFile) {
              nbGeolocatedTweets += 1

              try {
                writeInFile(
                  "streaming-" + id + ".txt", "\t" + keywordsSet  + "-subject#" + nbGeolocatedTweets.toString + ";" +
                  dateTimeFormat.format(status.getCreatedAt) + ";" + longitude + ";" + latitude + ";\"" +
                  status.getUser.getName + "\";\"" + status.getText + "\"\r\n"
                )
              } catch {
                case e: Exception => {
                  e.printStackTrace()
                  cantCreateFile = true
                  out ! JsObject(Seq("messageType" -> JsString("errorFile")))
                }
              }
            }

            out ! JsObject(Seq(
              "messageType"       -> JsString("newTweet"),
              "keywordsSet"       -> JsString(keywordsSet),
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
    * Opens a WebSocket's connection when a client access this entity. This connection receives and sends Json values.
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
    * Displays the Search page, allowing an user to search Tweets with the Twitter's APIs.
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
  def fileAction(action: String, firstSubject: Option[String], secondSubject: Option[String]) = AuthenticatedAction { request =>
    // Gets the file to either download or delete.
    val file = new File(baseFilePath + "streaming-" + request.session.get("id").get + ".txt")
    var fileName = ""

    // Sets the output file's name, according to the given parameters.
    if (firstSubject.nonEmpty) {
      fileName += firstSubject.get

      if (secondSubject.nonEmpty && secondSubject.get.nonEmpty) {
        fileName += "_" + secondSubject.get
      }

      fileName += "_"
    }

    fileName += "STREAMING_" + dateTimeFormat.format(new Date()) + ".txt"

    // Checks if the file exists.
    if (file.exists() && !file.isDirectory()) {
      // Then downloads or deletes it, depending on the action.
      action match {
        case "download" => {
          // The file to download will be named "[SUBJECT1]_[SUBJECT2]_STREAMING_[DATETIME].txt" for the user and won't
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
      BadRequest("The file you are trying to access does not exist anymore.")
    }
  }

  /**
    * Gets and returns the results of the static mode's search, when the user pressed the "View Results" of the "Static
    * Mode" tab in the Search page.
    */
  def staticResults = Action { request =>
    // Checks if the user is connected before continuing.
    if (isUserAuthenticated(request)) {
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
        fromDate = dateFormat.parse(request.queryString.get("fromDate").flatMap(_.headOption).get)
        toDate = dateFormat.parse(request.queryString.get("toDate").flatMap(_.headOption).get)
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
              var query: Query = new Query(fk)
              query.setCount(100)
              query.setSince(dateFormat.format(fd))
              query.setUntil(dateFormat.format(td))
              query.geoCode(new GeoLocation(lat, lng), rad, "km")
              if (!lan.isEmpty) {
                query.setLang(lan)
              }
              // Create the second query, only if the user set a second keywords set.
              var queryCopy = query
              var secondQuery = (if (secondKeywords.isEmpty) null else query)

              var results: QueryResult = twitter.search(query)
              var tweets: List[twitter4j.Status] = Nil

              // Since there can be a lot of results, the Twitter's API send us Tweets by page, so we have to browse all
              // pages in order to get all results.
              var i = 0
              while (i < 5 && results.getTweets.size() != 0) {
                println("OK1")

                var minId = Long.MaxValue

                do {
                  // If there are results, concats them to the current results' list.
                  if (results.getTweets.size() > 0) {
                    tweets ++= results.getTweets
                  }

                  query = results.nextQuery()

                  if (query != null) {
                    // Collect Tweets for the current page.
                    results = twitter.search(query)
                  }
                } while (query != null)

                tweets.foreach(s => if (s.getId < minId) minId = s.getId)
                query = queryCopy
                query.setMaxId(minId - 1)
                results = twitter.search(query)

                println("OK2")
                i += 1
              }

              println("OK3")

              // If the user only set one keywords set, sends the results
              if (secondKeywords.isEmpty) {
                Ok(JsObject(Seq(
                  "first" -> JsObject(Seq(
                    "tweets" -> JsArray(tweets.map(
                      status => Json.obj(
                        "subjectNumber" -> "first",
                        "date"          -> JsString(dateTimeFormat.format(status.getCreatedAt)),
                        "user"          -> JsString(status.getUser.getScreenName),
                        "latitude"      -> JsNumber(if (status.getGeoLocation != null) status.getGeoLocation.getLatitude else 0),
                        "longitude"     -> JsNumber(if (status.getGeoLocation != null) status.getGeoLocation.getLongitude else 0),
                        "content"       -> JsString(status.getText)
                      )
                    ))
                  ))
                )))
              // Otherwise collects the Tweets linked to the second stream and sends the Tweets of both subjects to the
              // client.
              } else {
                secondQuery.setQuery(secondKeywords)
                var secondTweets: List[twitter4j.Status] = Nil

                // pages in order to get all results.
                do {
                  // Collect Tweets for the current page.
                  results = twitter.search(secondQuery)

                  // If there are results, concats them to the current resutls' list.
                  if (results.getCount > 0) {
                    secondTweets ++= results.getTweets
                  }

                  secondQuery = results.nextQuery()
                } while (secondQuery != null)

                Ok(JsObject(Seq(
                  "first" -> JsObject(Seq(
                    "tweets" -> JsArray(tweets.map(
                      status => Json.obj(
                        "subjectNumber" -> "first",
                        "date"          -> JsString(dateTimeFormat.format(status.getCreatedAt)),
                        "user"          -> JsString(status.getUser.getScreenName),
                        "latitude"      -> JsNumber(if (status.getGeoLocation != null) status.getGeoLocation.getLatitude else 0),
                        "longitude"     -> JsNumber(if (status.getGeoLocation != null) status.getGeoLocation.getLongitude else 0),
                        "content"       -> JsString(status.getText)
                      )
                    ))
                  )),
                  "second" -> JsObject(Seq(
                    "tweets" -> JsArray(secondTweets.map(
                      status => Json.obj(
                        "subjectNumber" -> "second",
                        "date"          -> JsString(dateTimeFormat.format(status.getCreatedAt)),
                        "user"          -> JsString(status.getUser.getScreenName),
                        "latitude"      -> JsNumber(if (status.getGeoLocation != null) status.getGeoLocation.getLatitude else 0),
                        "longitude"     -> JsNumber(if (status.getGeoLocation != null) status.getGeoLocation.getLongitude else 0),
                        "content"       -> JsString(status.getText)
                      )
                    ))
                  ))
                )))
              }
            }
          }
        }
        case _ => Ok(JsObject(Seq("error" -> JsString("fieldEmptyOrNotValidZ"))))
      }
    // Sends an error message to the client if the user is no longer (or not at all) connected.
    } else {
      Ok(JsObject(Seq("error" -> JsString("sessionExpired"))))
    }
  }
}
