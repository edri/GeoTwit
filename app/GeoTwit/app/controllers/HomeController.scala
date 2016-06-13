package controllers

import javax.inject._

import play.api.mvc._
import twitter4j.auth.RequestToken
import twitter4j.{Twitter, TwitterException, TwitterFactory}

/**
 * This controller creates an `Action` to handle HTTP requests to the
 * application's home page.
 */
@Singleton
class HomeController extends Controller {
  private val CONSUMER_KEY = "InKH0FAxYqggrNLXGzxYIlRIP"
  private val CONSUMER_SECRET = "RG8g7CbESAM9MRbeJYOCchPyPxwdMZkcH9x76UXJkr4Ik8QJqK"

  /**
   * Create an Action to render an HTML page with a welcome message.
   * The configuration in the `routes` file means that this method
   * will be called when the application receives a `GET` request with
   * a path of `/`.
   *
   * Parameter:
   *    - error: optional parameter containing an error's string.
   */
  def index(error: Option[String]) = Action {
    Ok(views.html.index(error))
  }

  /**
  * Occurs when the user clicked on the "Get Started" button of the home page.
  * Redirects the user on the Twitter's connection page, giving it the URL of
  * the callback function, which corresponds to the "callback" action below.
  */
  def auth = Action { request =>
    val url =
      if(request.host.contains(":9000"))
        "http://" + request.host + "/callback"
      else
        "https://" + request.host + "/callback"

    val twitter: Twitter = new TwitterFactory().getInstance()
    twitter.setOAuthConsumer(CONSUMER_KEY, CONSUMER_SECRET)

    try {
      val requestToken: RequestToken = twitter.getOAuthRequestToken(url)
      Redirect(requestToken.getAuthenticationURL)
    } catch {
      case e: TwitterException => Redirect(routes.HomeController.index(Some("errorGettingApplicationToken")))
    }
  }

  /**
  * Redirects the user either on the search page if the connection was
  * successful or on the home page if there is an error or the user denied the
  * connection process. This action is called anyway by the Twitter's API when
  * the user leaves the Twitter's connection page.
  *
  * Parameters:
  *     - denied: if set, this means the user denied the Twitter's connection
  *               process. It also mmeans that the two following parameters are
  *               null.
  *     - oauthToken: if the "denied" parameter is null, this parameters
  *                   contains the token's string value.
  *     - oauthVerifier: if the "denied" parameter is null, this parameters
  *                      contains a string used by Twitter to verify the
  *                      requests.
  */
  def callback(denied: Option[String], oauthToken: Option[String], oauthVerifier: Option[String]) = Action {
    denied match {
      case Some(_) => Redirect(routes.HomeController.index(Some("errorDenied")))
      case None => (oauthToken, oauthVerifier) match {
        case (Some(_), Some(_)) => Redirect(routes.SearchController.index)
        case _ => Redirect(routes.HomeController.index(Some("error")))
      }
    }
  }

}
