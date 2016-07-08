/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */


import java.io.IOException;
import java.util.concurrent.ExecutionException;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.prefs.Preferences;
import javax.json.Json;
import javax.json.JsonObject;
import twitter4j.FilterQuery;
import twitter4j.GeoLocation;
import twitter4j.StallWarning;
import twitter4j.Status;
import twitter4j.StatusDeletionNotice;
import twitter4j.StatusListener;
import twitter4j.Twitter;
import twitter4j.TwitterException;
import twitter4j.TwitterFactory;
import twitter4j.TwitterStream;
import twitter4j.TwitterStreamFactory;
import twitter4j.auth.AccessToken;
import twitter4j.auth.RequestToken;
import twitter4j.conf.Configuration;
import twitter4j.conf.ConfigurationBuilder;

/**
 *
 * @author miguel
 */
public class Streaming {
   public final String CONSUMER_KEY = "zvPuOcouiYZTC1SX8oxxFUJlF";
   public final String CONSUMER_SECRET = "DtKSu11TQeqly23aJbpjNtGM2KtQoz71zBCPhLNt76I6daJOXV";
   public Twitter twitter = TwitterFactory.getSingleton();
   
   private AccessToken accessToken;
   private RequestToken requestToken;
   private Configuration configuration;
   private TwitterStream twitterStream;
   private long nbReceivedTweets = 0;
   private long nbTweetsWithLocation = 0;
   private long nbTweetsWithRightLocation = 0;
   
   /**
    * Reset all application's preferences (the stored token - used for debugging).
    */
   public void resetPreferences() {
      Preferences prefs = Preferences.userNodeForPackage(Streaming.class);
      prefs.remove("token");
      prefs.remove("tokenSecret");
   }
   
   public void stopStreaming() {
      twitterStream.clearListeners();
      twitterStream.shutdown();
   }
   
   /**
    * Store the given Twitter API's access token in the application's preferences so it will
    * be persisted for the next application's using.
    * @param accessToken the token to store
    */
   private void storeAccessToken(AccessToken accessToken) {
      System.out.print("Persisting token...");
      Preferences prefs = Preferences.userNodeForPackage(Streaming.class);
      prefs.put("token", accessToken.getToken());
      prefs.put("tokenSecret", accessToken.getTokenSecret());
      System.out.println("Done!");
   }
   
   /**
    * Try to load the token persisted in the application's preferences.
    * @return the persisted token if it exists, else return 'null'
    */
   private AccessToken loadAccessToken() {
      System.out.println("Trying to get the persisted token...");
      Preferences prefs = Preferences.userNodeForPackage(Streaming.class);
      String token = prefs.get("token", null);
      String tokenSecret = prefs.get("tokenSecret", null);
      // Return the token if it has been persisted, else return null.
      return (token != null || tokenSecret != null ? new AccessToken(token, tokenSecret) : null);
   }
   
   private void initializeConfiguration() throws IOException, InterruptedException, ExecutionException {
      // Then initialize and build the configuration builder, which contains all
      // keys and tokens used in the OAuth protocole.
      ConfigurationBuilder cb = new ConfigurationBuilder();
      cb.setDebugEnabled(true)
              .setOAuthConsumerKey(CONSUMER_KEY)
              .setOAuthConsumerSecret(CONSUMER_SECRET)
              .setOAuthAccessToken(accessToken.getToken())
              .setOAuthAccessTokenSecret(accessToken.getTokenSecret());
      configuration = cb.build();

      // Send a success message to the client.
      JsonObject jsonMessage = Json.createObjectBuilder()
                 .add("message", "successfulInit")
                 .build();
      WebsocketServer.sendMessage(jsonMessage.toString());
            
      // Start streaming's reading.
      readStreaming("euro2016", true);
   }
   
   /**
    * Get and return the application's access token, which will be used for the
    * Twitter's APIs' queries.
    * @param pin
    * @throws TwitterException
    * @throws IOException 
    * @throws java.lang.InterruptedException 
    * @throws java.util.concurrent.ExecutionException 
    */
   public void createApplicationAccessToken(String pin) throws TwitterException, IOException, InterruptedException, ExecutionException {
         try {
            accessToken = twitter.getOAuthAccessToken(requestToken, pin);
            System.out.println("Yay! Token successfully got: " + accessToken);
            
            // Persist the access token for future references.
            storeAccessToken(accessToken);
            // Initialize the application's configuration.
            initializeConfiguration();
         } catch (TwitterException te) {
            if (te.getStatusCode() == 401) {
               System.out.println("Unable to get the access token.");
               
            } else {
               te.printStackTrace();
            }
            
            // Send a "wrong token" JSON message to the client.
            JsonObject jsonMessage = Json.createObjectBuilder()
                 .add("message", "incorrectPin")
                 .build();
            WebsocketServer.sendMessage(jsonMessage.toString());
         }
   }
   
   public void initializeToken() throws TwitterException, IOException, InterruptedException, ExecutionException {
      accessToken = loadAccessToken();
      
      // Ask the javascript application for an access token if there is no persisted
      // token yet.
      if (accessToken == null) {
         System.out.println("The token doesn't exist yet, creating a new one...");
         // Get token's authorization URL and create the JSON object to send.
         twitter.setOAuthConsumer(CONSUMER_KEY, CONSUMER_SECRET);
         requestToken = twitter.getOAuthRequestToken();
         JsonObject jsonMessage = Json.createObjectBuilder()
                 .add("message", "askAccessToken")
                 .add("url", requestToken.getAuthorizationURL())
                 .build();
         // Send the JSON object.
         WebsocketServer.sendMessage(jsonMessage.toString());
      // Otherwise we just initialize the configuration and start the streaming process.
      } else {
         initializeConfiguration();
      }
   }
   
   /**
    * Subscribe to a Twitter streaming flow, identified by the given query and
    * the given coordinates
    * @param queryString the string query, which will be used to filter Tweets.
    * @param showDetails indicate if the user want to see details (Tweets, miscellaneous messages, etc. - true) or just the stats (false).
    * @throws IOException
    * @throws InterruptedException
    * @throws ExecutionException 
    */
   public void readStreaming(String queryString, boolean showDetails) throws IOException, InterruptedException, ExecutionException {
      // Switzerland's coordinates, format {longitude, latitude}
      //double[] southwestCoordinates = {5.956085, 45.817851};
      //double[] northeastCoordinates = {10.489254, 47.808454};
      // France's coordinates
      double[] southwestCoordinates = {-4.805145263671875, 42.34528267746347};
      double[] northeastCoordinates = {8.232879638671875, 51.09052797518529};
      // USA's coordinates
      //double[] southwestCoordinates = {-124.411668, 24.957884};
      //double[] northeastCoordinates = {-66.888435, 49.001895};
      // UK's coordinates
      //double[] southwestCoordinates = {-8.306947, 49.696022};
      //double[] northeastCoordinates = {1.801128, 59.258967};
      // Italy's coordinates
      //double[] southwestCoordinates = {6.6357421875, 36.577893995157474};
      //double[] northeastCoordinates = {18.6328125, 47.09805038936004}; 
      // Iceland's coordinates
      //double[] southwestCoordinates = {-24.5269775390625, 63.29586049456984};
      //double[] northeastCoordinates = {-13.3978271484375, 66.53718450345829};
      // Germany-Poland area's coordinates
      //double[] southwestCoordinates = {5.86669921875, 47.27010385272593};
      //double[] northeastCoordinates = {24.145889282226562, 54.91124458876571};
      // France-Switzerland area's coordinates
      //double[] southwestCoordinates = {-4.805145263671875, 42.34528267746347};
      //double[] northeastCoordinates = {10.489254, 51.09052797518529};
      // Italy-Spain area's coordinates
      //double[] southwestCoordinates = {-9.300956726074219, 36.00001893207416};
      //double[] northeastCoordinates = {18.6328125, 47.09805038936004};
      
      StreamingStatsThread sst = new StreamingStatsThread(queryString, 600 * 1000, this);
      
      StatusListener listener = new StatusListener() {
         @Override
         public void onStatus(Status status) {
            ++nbReceivedTweets;
            GeoLocation geoLocation = status.getGeoLocation();
            
            if (geoLocation != null) {
               ++nbTweetsWithLocation;
               
               double longitude = geoLocation.getLongitude();
               double latitude = geoLocation.getLatitude();

               if (longitude >= southwestCoordinates[0] && longitude <= northeastCoordinates[0] &&
                   latitude >= southwestCoordinates[1] && latitude <= northeastCoordinates[1]) {
                  ++nbTweetsWithRightLocation;

                  if (showDetails) {
                     try {
                        // Send the new Tweet's data to the client.
                        JsonObject jsonMessage = Json.createObjectBuilder()
                                .add("message", "newTweet")
                                .add("longitude", longitude)
                                .add("latitude", latitude)
                                .add("user", status.getUser().getName())
                                .add("content", status.getText())
                                .build();
                        WebsocketServer.sendMessage(jsonMessage.toString());
                     } catch (IOException ex) {
                        Logger.getLogger(Streaming.class.getName()).log(Level.SEVERE, null, ex);
                     }
                     System.out.println(longitude + "," + latitude + " => " + status.getUser().getName() + " : " + status.getText());
                  }
               }
            }
         }
         
         @Override
         public void onDeletionNotice(StatusDeletionNotice statusDeletionNotice) {
            if (showDetails) {
               System.out.println("Got a status deletion notice id:" + statusDeletionNotice.getStatusId());
            }
         }
         
         @Override
         public void onTrackLimitationNotice(int numberOfLimitedStatuses) {
            if (showDetails) {
               System.out.println("Got track limitation notice:" + numberOfLimitedStatuses);
            }
         }

         @Override
         public void onScrubGeo(long userId, long upToStatusId) {
            if (showDetails) {
               System.out.println("Got scrub_geo event userId:" + userId + " upToStatusId:" + upToStatusId); 
            }
         }

         @Override
         public void onStallWarning(StallWarning warning) {
            if (showDetails) {
               System.out.println("Got stall warning:" + warning);
            }
         }
         
         @Override
         public void onException(Exception ex) {
            ex.printStackTrace();
         }
      };
      
      twitterStream = new TwitterStreamFactory(configuration).getInstance();
      twitterStream.addListener(listener);
      FilterQuery fq = new FilterQuery(queryString);
      //double[][] location = {southwestCoordinates, northeastCoordinates};
      //fq.locations(location);
      twitterStream.filter(fq);
   }
   
   /**
    * Return the current number of received Tweets from the Streaming API.
    * @return the current number of received Tweets
    */
   public long getNbReveivedTweets() {
      return nbReceivedTweets;
   }
   
   /**
    * Return the current number of received Tweets, which own a geolocation tag.
    * @return the current number of received Tweets, which own a geolocation tag
    */
   public long getNbTweetsWithLocation() {
      return nbTweetsWithLocation;
   }
   
   /**
    * Return the current number of received Tweets, which own a geolocation tag
    * that matches with the location filter.
    * @return the current number of received Tweets, which own a geolocation tag
    * that matches with the location filter
    */
   public long getNbTweetsWithRightLocation() {
      return nbTweetsWithRightLocation;
   }
   
   /**
    * Reset the current numbers of received Tweets.
    */
   public void resetData() {
      nbReceivedTweets = nbTweetsWithLocation = nbTweetsWithRightLocation = 0;
   }
}
