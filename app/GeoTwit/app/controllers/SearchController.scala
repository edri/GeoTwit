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
    val northeastCoordinates: Array[Double] = Array(-66.888435, 49.001895)
    val southwestCoordinates: Array[Double] = Array(-124.411668, 24.957884)

    // Sends a successful initialization's status as soon as the connection has been established.
    out ! JsObject(Seq(
      "messageType" -> JsString("successfulInit"),
      "northeastCoordinates"  -> JsArray(Seq(JsNumber(northeastCoordinates(0)), JsNumber(northeastCoordinates(1)))),
      "southwestCoordinates"  -> JsArray(Seq(JsNumber(southwestCoordinates(0)), JsNumber(southwestCoordinates(1))))
    ))

    // Instantiates the Twitter's stream object used to work with the Streaming API and starts the streaming.
    val twitterStream: TwitterStream = new TwitterStreamFactory().getInstance()

    /**
      * Occurs when the web socket server received a new Json message from the client.
      */
    def receive = {
      case data: JsValue =>
        // Searchs for the received message's type.
        (data \ "messageType").validate[String] match {
          // Occurs when the client successfully displayed the result components and asked the server to begin the
          // stream.
          case JsSuccess("readyToStream", _) =>
            println("Yay, ready to stream!")
            streaming(out, id, twitterStream, "job", northeastCoordinates, southwestCoordinates)
          // Stops streaming when the user clicked on the well-named button.
          case JsSuccess("stopStreaming", _) => out ! PoisonPill
        }
    }

    /**
      * Stop the currents streaming if the socket is destroyed.
      */
    override def postStop() = {
      println("Got it, I am stopping the streaming process...")
      twitterStream.clearListeners()
      twitterStream.shutdown()
    }
  }

  /**
    * Starts a new Twitter's streaming, by the given parameters.
    * @param out the actor who is in charge of the current client's web socket discussion.
    * @param sessionId the current session's unique ID
    * @param twitterStream a instantiated (but not configured) Twitter's stream object
    * @param query the query used to filter the streaming of Tweets
    * @param northeastCoordinates the northeast coordinates of the bounding box in which the Tweets will be searched.
    * @param southwestCoordinates the southwest coordinates of the bounding box in which the Tweets will be searched.
    */
  def streaming(out: ActorRef, sessionId: String, twitterStream: TwitterStream, query: String, northeastCoordinates: Array[Double], southwestCoordinates: Array[Double]) = {
    // Gets the cached Twitter object, which will be used to correctly configure the Twitter's stream object.
    val getTwitter = cache.get[Twitter](sessionId + "-twitter")

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
        // Initializes a listener that will listen to the Twitter's streaming and react by the received type of message.
        val listener: StatusListener = new StatusListener {
          /**
            * Occurs when the listener received a new Tweet from the Twitter's API.
            * Checks if the received Tweet has a geolocation tag, and if so, sends a new web socket to the client in
            * order to inform it.
            * @param status the new Tweet's data
            */
          override def onStatus(status: twitter4j.Status): Unit = {
            val geoLocation: GeoLocation = status.getGeoLocation

            if (geoLocation != null) {
              val longitude: Double = geoLocation.getLongitude
              val latitude: Double = geoLocation.getLatitude

              // Sends a web socket to the client if the received Tweet is located into the given coordinates.
              if (longitude >= southwestCoordinates(0) && longitude <= northeastCoordinates(0) &&
                  latitude >= southwestCoordinates(1) && latitude <= northeastCoordinates(1)) {
                out ! JsObject(Seq(
                  "messageType" -> JsString("newTweet"),
                  "longitude"   -> JsNumber(longitude),
                  "latitude"    -> JsNumber(latitude),
                  "user"        -> JsString(status.getUser.getName),
                  "content"     -> JsString(status.getText)
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

        // Sets the Twitter's Stream object with the Twitter object's configuration.
        twitterStream.setOAuthConsumer(
          config.getString("twitter4j.oauth.consumerKey"),
          config.getString("twitter4j.oauth.consumerSecret")
        )
        twitterStream.setOAuthAccessToken(twitter.getOAuthAccessToken)
        // Starts streaming with the given filter.
        val fq: FilterQuery = new FilterQuery(query)
        twitterStream.addListener(listener)
        twitterStream.filter(fq)
      }
    }
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
