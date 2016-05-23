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
   */
  def index(error: Option[String]) = Action {
    Ok(views.html.index(error))
  }

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

  def callback(denied: Option[String], oauthToken: Option[String], oauthVerifier: Option[String]) = Action {
    denied match {
      case Some(_) => Redirect(routes.HomeController.index(Some("errorDenied")))
      case None => (oauthToken, oauthVerifier) match {
        case (Some(_), Some(_)) => Redirect(routes.HomeController.search)
        case _ => Redirect(routes.HomeController.index(Some("error")))
      }
    }
  }

  def search = Action {
    Ok(views.html.search())
  }

}
