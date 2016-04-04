/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package twitter4jDesktop;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.concurrent.ExecutionException;
import java.util.prefs.Preferences;
import twitter4j.FilterQuery;
import twitter4j.GeoLocation;
import twitter4j.Query;
import twitter4j.QueryResult;
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
public class MainExecution {
   public final String CONSUMER_KEY = "zvPuOcouiYZTC1SX8oxxFUJlF";
   public final String CONSUMER_SECRET = "DtKSu11TQeqly23aJbpjNtGM2KtQoz71zBCPhLNt76I6daJOXV";
   public Twitter twitter = TwitterFactory.getSingleton();
   
   private final AccessToken accessToken;
   private final Configuration configuration;
   private long nbReceivedTweets = 0;
   private long nbTweetsWithLocation = 0;
   private long nbTweetsWithRightLocation = 0;
   
   /**
    * Store the given Twitter API's access token in the application's preferences so it will
    * be persisted for the next application's using.
    * @param accessToken the token to store
    */
   private void storeAccessToken(AccessToken accessToken) {
      System.out.print("Persisting token...");
      Preferences prefs = Preferences.userNodeForPackage(Twitter4j.class);
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
      Preferences prefs = Preferences.userNodeForPackage(Twitter4j.class);
      String token = prefs.get("token", null);
      String tokenSecret = prefs.get("tokenSecret", null);
      // Return the token if it has been persisted, else return null.
      return (token != null || tokenSecret != null ? new AccessToken(token, tokenSecret) : null);
   }
   
   /**
    * Read a well-formated user input, which corresponds to a positive number of 
    * seconds and return it.
    * @return the number of seconds the user entered
    * @throws IOException 
    */
   private long readSeconds() throws IOException {
      BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
      boolean successReading = false;
      long seconds = 0;
      
      // Get a well-formated positive integer.
      do {
         System.out.print("How long do you want the streaming to run (in seconds)? ");
         
         try {
            seconds = Long.parseLong(br.readLine());
            
            if (seconds > 0) {            
               successReading = true;
            } else {
               System.out.println("Please enter a numeric value greater than 0.");
            }
         } catch (NumberFormatException e) {
            System.out.println("Please enter a numeric value greater than 0.");
         }
      } while (!successReading);
      
      return seconds;
   }
   
   /**
    * Get and return the application's access token, which will be used for the
    * Twitter's APIs' queries.
    * @return the access token
    * @throws TwitterException
    * @throws IOException 
    */
   private AccessToken getApplicationAccessToken() throws TwitterException, IOException {
      // Try to get the possibly-persisted token.
      AccessToken token = loadAccessToken();
      
      // Get a new token if there is no persisted one.
      if (token == null) {
         System.out.println("The token doesn't exist yet, creating a new one...");
         twitter.setOAuthConsumer(CONSUMER_KEY, CONSUMER_SECRET);
         RequestToken requestToken = twitter.getOAuthRequestToken();
         BufferedReader br = new BufferedReader(new InputStreamReader(System.in));

         do {
            System.out.println("Open the following URL and grant access to your account:");
            System.out.println(requestToken.getAuthorizationURL());
            System.out.print("Enter the PIN (if aviailable) or just hit enter. [PIN]: ");
            String pin = br.readLine();

            try {
               if (pin.length() > 0) {
                  token = twitter.getOAuthAccessToken(requestToken, pin);
                  System.out.println("Yay! Token successfully got: " + token);
               } else {
                  token = twitter.getOAuthAccessToken();
               }
            } catch (TwitterException te) {
               if (te.getStatusCode() == 401) {
                  System.out.println("Unable to get the access token.");
               } else {
                  te.printStackTrace();
               }
            }
         } while (token == null);

         // Persist the access token for future references.
         storeAccessToken(token);
      } else {
         System.out.println("Persisted token successfully got!");
      }
      
      return token;
   }
   
   public MainExecution() throws TwitterException, IOException {
      // First get a Twitter's access token for the running application.
      accessToken = getApplicationAccessToken();
      // Then initialize and build the configuration builder, which contains all
      // keys and tokens used in the OAuth protocole.
      ConfigurationBuilder cb = new ConfigurationBuilder();
      cb.setDebugEnabled(true)
              .setOAuthConsumerKey(CONSUMER_KEY)
              .setOAuthConsumerSecret(CONSUMER_SECRET)
              .setOAuthAccessToken(accessToken.getToken())
              .setOAuthAccessTokenSecret(accessToken.getTokenSecret());
      configuration = cb.build();
   }
   
   /**
    * Get and show Tweets, which are related to the given query.
    * @param queryString the query's string
    * @throws TwitterException 
    */
   public void getAndShowTweets(String queryString) throws TwitterException {
      Query query = new Query(queryString);
      QueryResult result = twitter.search(query);

      System.out.println(result.getTweets().size() + " available Tweet(s).");

      result.getTweets().stream().forEach((status) -> {
         System.out.println("@" + status.getUser().getScreenName() + ":" + status.getText());
      });
   }
   
   /**
    * Subscribe to a Twitter streaming flow, identified by the given query and
    * the given coordinates
    * @param queryString the string query, which will be used to filter Tweets.
    * @param southwestCoordinates the southwest coordinates of the rectangle, which will be used to get Tweets in.
    * @param northeastCoordinates the northeast coordinates of the rectangle, which will be used to get Tweets in.
    * @param showDetails indicate if the user want to see details (Tweets, miscellaneous messages, etc. - true) or just the stats (false).
    * @throws IOException
    * @throws InterruptedException
    * @throws ExecutionException 
    */
   public void readStreaming(String queryString, double[] southwestCoordinates, 
                             double[] northeastCoordinates, boolean showDetails) throws IOException, InterruptedException, ExecutionException {
      StreamingStatsThread sst = new StreamingStatsThread(queryString, readSeconds() * 1000, this);
      
      StatusListener listener = new StatusListener() {
         @Override
         public void onStatus(Status status) {
            ++nbReceivedTweets;
            GeoLocation geoLocation = status.getGeoLocation();
            
            if (geoLocation != null) {
               ++nbTweetsWithLocation;
               
               if (showDetails) {
                  double longitude = geoLocation.getLongitude();
                  double latitude = geoLocation.getLatitude();

                  if (longitude >= southwestCoordinates[0] && longitude <= northeastCoordinates[0] &&
                      latitude >= southwestCoordinates[1] && latitude <= northeastCoordinates[1]) {
                     ++nbTweetsWithRightLocation;
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
      
      TwitterStream twitterStream = new TwitterStreamFactory(configuration).getInstance();
      twitterStream.addListener(listener);
      FilterQuery fq = new FilterQuery();
      double[][] location = {southwestCoordinates, northeastCoordinates};
      fq.locations(location);
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
      nbReceivedTweets = nbTweetsWithLocation = 0;
   }
}
