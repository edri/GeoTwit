/**
  * Author:       Miguel Santamaria
  * Date:         13.06.2016
  * Description:  This controller contains all the actions related to the Home page and the connection process of the
  *               Twitter's APIs.
  *               The user must not be connected to access these actions, unless for the "logout" one.
  */

package controllers

import java.util.UUID
import javax.inject._

import com.typesafe.config.ConfigFactory
import play.api.Configuration
import play.api.cache.CacheApi

import scala.concurrent.duration._
import play.api.mvc._
import twitter4j.auth.RequestToken
import twitter4j._

import scala.concurrent.Future

/**
 * This controller creates an `Action` to handle HTTP requests to the application's home page.
 */
@Singleton
class HomeController @Inject() (cache: CacheApi, configuration: Configuration) extends Controller {
  val config = ConfigFactory.load("twitter.conf")

  /**
    * Represents an actions composition, which can be interpreted like a generic action functionality.
    * This actions composition checks if the user is not already identified when he tries to access an action of this
    * controller (unless the "logout" one). If so, it redirects the user to the Search page.
    * This acts like a filter, but for specific actions.
    *
    * More information about composition here: https://www.playframework.com/documentation/2.2.x/ScalaActionsComposition
    */
  object NotAuthenticatedAction extends ActionBuilder[Request] {
    // The invokeBlock method is called for every action built by the ActionBuilder.
    def invokeBlock[A](request: Request[A], block: (Request[A]) => Future[Result]) = {
      // Checks that the session have an unique ID.
      request.session.get("id") match {
        case Some(id) =>
          // Redirects the user to the Search page if he is already connected to the application, otherwise just give the
          // action the control of the request.
          (cache.get(id + "-twitter"), request.session.get("username")) match {
            // Redirects the user to the search page if he is already connected to the application.
            case (Some(_), Some(_)) => Future.successful(Redirect(routes.SearchController.index))
            // Otherwise just give the action the control of the request.
            case _ => block(request)
          }
        case None => block(request)
      }
    }
  }

  /**
   * Creates an Action to render an HTML page with a welcome message.
   * The configuration in the `routes` file means that this method will be called when the application receives a `GET`
   * request with a path of `/`.
   * This action uses the AuthenticationAction actions composition, in order to check that the user is not already
   * connected.
   * If the user was redirected from another page with a flash error, the action passes it to the view.
   */
  def index = NotAuthenticatedAction { implicit request =>
    // Gets and passes the flash error to the view if there is one, otherwise just passes a "success" string.
    Ok(views.html.index(request.flash.get("error").getOrElse("success")))
  }

  /**
  * Occurs when the user clicked on the "Get Started" button of the home page.
  * Redirects the user on the Twitter's connection page, giving it the URL of the callback function, which corresponds
  * to the "callback" action below.
  */
  def auth = NotAuthenticatedAction { implicit request =>
    val callbackUrl =
      if(request.host.contains(":9000"))
        "http://" + request.host + "/callback"
      else
        "https://" + request.host + "/callback"

    // Initializes the Twitter object with the right consumer's key and secret present in the "twitter.conf"
    // configuration file.
    val twitter: Twitter = (new TwitterFactory()).getInstance()
    twitter.setOAuthConsumer(config.getString("twitter4j.oauth.consumerKey"),
                             config.getString("twitter4j.oauth.consumerSecret"))

    try {
      // Gets the request token from the Twitter's API, in order to get the Twitter's authentication URL.
      val requestToken: RequestToken = twitter.getOAuthRequestToken(callbackUrl)
      // Generates an unique ID, in order to recognize the current user in the cache.
      val uniqueId = UUID.randomUUID()

      // Writes the Twitter and RequestToken objects in the cache, since
      // we cannot store objects in sessions with Play.
      cache.set(uniqueId + "-tmpTwitter", twitter, 2.minutes)
      cache.set(uniqueId + "-requestToken", requestToken, 2.minutes)

      // Redirects the user to the Twitter's authentication URL and add the unique ID's value in the session.
      Redirect(requestToken.getAuthenticationURL).withSession("id" -> uniqueId.toString)
    } catch {
      case e: TwitterException =>
        Redirect(routes.HomeController.index).flashing(
          "error" -> "errorGettingApplicationToken"
        )
    }
  }

  /**
    * Redirects the user either on the search page if the connection was successful or on the home page if there is an
    * error or the user denied the connection process. This action is called anyway by the Twitter's API when the user
    * leaves the Twitter's connection page.
    *
    * @param denied if set, this means the user denied the Twitter's connection process. It also means that the two
    *               following parameters are null.
    * @param oauthToken if the "denied" parameter is null, this parameters contains the token's string value.
    * @param oauthVerifier if the "denied" parameter is null, this parameters contains a string used by Twitter to
    *                      verify the future requests.
    */
  def callback(denied: Option[String], oauthToken: Option[String],
               oauthVerifier: Option[String]) = NotAuthenticatedAction { implicit request =>
    // First checks if the user did not denied the connection process.
    denied match {
      case Some(_)  => Redirect(routes.HomeController.index).flashing("error" -> "errorDenied")
      // Then checks if we successfully received the OAuth's token and verifier as well as the session's unique ID.
      case _        => {
        (oauthToken, oauthVerifier, request.session.get("id")) match {
          case (Some(_), Some(verifier), Some(id)) => {
            val getTwitter = cache.get[Twitter](id + "-tmpTwitter")
            val getRequestToken = cache.get[RequestToken](id + "-requestToken")

            // Tries to get the Twitter and RequestToken objects from the cache.
            (getTwitter, getRequestToken) match {
              case (Some(twitter), Some(requestToken)) => {
                // Get the authentication's token, in order to be able to make requests to the APIs.
                twitter.getOAuthAccessToken(requestToken, verifier)

                // Removes objects from the cache.
                cache.remove(id + "-tmpTwitter")
                cache.remove(id + "-requestToken")
                // Then sets the new Twitter object.
                cache.set(id + "-twitter", twitter, configuration.getMilliseconds("play.http.session.maxAge").get.milliseconds)

                // Sets the user's name in the session and redirects him to the Search page.
                Redirect(routes.SearchController.index).withSession(
                  request.session +
                  ("username" -> twitter.showUser(twitter.getId()).getScreenName())
                )
              }
              case _ => Redirect(routes.HomeController.index).flashing("error" -> "sessionExpired")
            }
          }
          case _ => Redirect(routes.HomeController.index).flashing("error" -> "error")
        }
      }
    }
  }

  /**
    * Disconnects the connected user and redirects him to the home page.
    */
  def logout = Action { implicit request =>
    // Clears the current user's cache the session have an unique ID.
    if (!request.session.get("id").isEmpty) {
      cache.remove(request.session.get("id").get + "-twitter")
    }

    // Discards the whole session, then redirects the user.
    // Also passes the error if there was one, otherwise just passes the "success" string.
    Redirect(routes.HomeController.index).withNewSession.flashing(
      "error" -> request.flash.get("error").getOrElse("success")
    )
  }
}
