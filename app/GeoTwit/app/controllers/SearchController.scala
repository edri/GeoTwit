/**
  * Author:       Miguel Santamaria
  * Date:         13.06.2016
  * Description:  This controller contains all the actions related to the search of Tweets through the Twitter's APIs.
  *               The user must be connected to access these actions.
  */

package controllers

import javax.inject._

import akka.actor._
import akka.stream.Materializer
import com.typesafe.config.ConfigFactory
import play.api.Configuration
import play.api.cache.CacheApi
import play.api.libs.json._
import play.api.mvc._
import play.api.libs.streams._
import twitter4j._

import scala.collection.mutable.ListBuffer
import scala.concurrent.Future

/**
  * This controller creates an `Action` to handle HTTP requests to the application's search page.
  *
  * @param system used by the WebSocket system's actors.
  * @param materializer used by the WebSocket system's actors.
  * @param cache the cache object used to access the server's cache.
  * @param configuration the configuration object used to access the server's configuration.
  */
@Singleton
class SearchController @Inject() (implicit system: ActorSystem, materializer: Materializer, cache: CacheApi, configuration: Configuration) extends Controller {
  val config = ConfigFactory.load("twitter.conf")

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
    def props(out: ActorRef, id: String) = Props(new StreamingSocketActor(out, id))
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
                      "messageType" -> JsString("sessionExpired")
                    ))

                    // Kills the actor in charge of the current client. This will also stop the current streaming process.
                    out ! PoisonPill
                  }
                  case Some(twitter) => {
                    // Sets the Twitter's Stream object with the Twitter object's configuration.
                    twitterStreams(0).setOAuthConsumer(
                      config.getString("twitter4j.oauth.consumerKey"),
                      config.getString("twitter4j.oauth.consumerSecret")
                    )
                    twitterStreams(0).setOAuthAccessToken(twitter.getOAuthAccessToken)

                    streaming(out, twitterStreams(0), "first", fk, c(0), c(2), l)

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

                      streaming(out, twitterStreams(1), "second", sk, c(0), c(2), l)
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
      out ! JsObject(Seq("messageType" -> JsString("stopStreaming")))

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
    * Starts a new Twitter's streaming, by the given parameters.
    *
    * @param out the actor who is in charge of the current client's web socket discussion.
    * @param twitterStream a instantiated and configured Twitter's stream object
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
  def streaming(out: ActorRef, twitterStream: TwitterStream, keywordsSet: String, query: String,
                southwestCoordinates: Array[Double], northeastCoordinates: Array[Double], language: String) = {
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
        ex.printStackTrace
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
    * Display the Search page, allowing an user to search Tweets with the Twitter's APIs.
    * The user must be connected to access this action.
    */
  def index = AuthenticatedAction { request =>
    Ok(views.html.search(request.session.get("username").get)(request))
  }
}
