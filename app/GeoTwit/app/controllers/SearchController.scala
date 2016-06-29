/**
  * Author:       Miguel Santamaria
  * Date:         13.06.2016
  * Description:  This controller contains all the actions related to the search of Tweets through the Twitter's APIs.
  *               The user must be connected to access these actions.
  */

package controllers

import javax.inject._

import com.typesafe.config.ConfigFactory
import play.api.Configuration
import play.api.cache.CacheApi
import play.api.mvc._

import scala.concurrent.Future

/**
 * This controller creates an `Action` to handle HTTP requests to the application's search page.
 */
@Singleton
class SearchController @Inject() (cache: CacheApi, configuration: Configuration) extends Controller {
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
      // Checks that the session have an unique ID.
      request.session.get("id") match {
        case Some(id) => {
          // Redirects the user to the Home page if he is not connected, otherwise just give the current action the control
          // of the request.
          (cache.get(id + "-twitter"), request.session.get("username")) match {
            // Gives the control to the current action.
            case (Some(_), Some(_)) =>
              block(request)
            // Redirects the user to the Logout page (to ensure everything is properly cleaned) if he is not connected to
            // the application.
            case _ =>
              Future.successful(Redirect(routes.HomeController.logout).flashing(
                "error" -> "error"
              ))
          }
        }
        case None =>
          Future.successful(Redirect(routes.HomeController.logout).flashing(
            "error" -> "sessionExpired"
          ))
      }
    }
  }

  /**
    * Display the Search page, allowing an user to search Tweets with the Twitter's APIs.
    * The user must be connected to acces this action.
    */
  def index = AuthenticatedAction { request =>
    Ok(views.html.search())
  }
}
