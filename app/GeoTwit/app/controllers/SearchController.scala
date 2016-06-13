package controllers

import javax.inject._

import play.api.mvc._
import twitter4j.auth.RequestToken
import twitter4j.{Twitter, TwitterException, TwitterFactory}

/**
 * This controller creates an `Action` to handle HTTP requests to the
 * application's search page.
 */
@Singleton
class SearchController extends Controller {

  def index = Action {
    Ok(views.html.search())
  }

}
