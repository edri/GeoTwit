/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package twitter4jDesktop;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
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
public class Twitter4j {
   public static final String CONSUMER_KEY = "zvPuOcouiYZTC1SX8oxxFUJlF";
   public static final String CONSUMER_SECRET = "DtKSu11TQeqly23aJbpjNtGM2KtQoz71zBCPhLNt76I6daJOXV";
   public static Twitter twitter = TwitterFactory.getSingleton();

   /**
    * Get and return the application's access token, which will be used for the
    * Twitter's APIs' queries.
    * @return the access token
    * @throws TwitterException
    * @throws IOException 
    */
   public static AccessToken getApplicationAccessToken() throws TwitterException, IOException {
      twitter.setOAuthConsumer(CONSUMER_KEY, CONSUMER_SECRET);
      RequestToken requestToken = twitter.getOAuthRequestToken();
      AccessToken accessToken = null;
      BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
      
      while (accessToken == null) {
         System.out.println("Open the following URL and grant access to your account:");
         System.out.println(requestToken.getAuthorizationURL());
         System.out.print("Enter the PIN (if aviailable) or just hit enter. [PIN]: ");
         String pin = br.readLine();
         
         try {
            if (pin.length() > 0) {
               accessToken = twitter.getOAuthAccessToken(requestToken, pin);
               System.out.println("Yay! Token successfully got: " + accessToken);
            } else {
               accessToken = twitter.getOAuthAccessToken();
            }
         } catch (TwitterException te) {
            if (te.getStatusCode() == 401) {
               System.out.println("Unable to get the access token.");
            } else {
               te.printStackTrace();
            }
         }
      }
      
      return accessToken;
   }
   
   /**
    * Get and show Tweets, which are related to the given query.
    * @param queryString the query's string
    * @throws TwitterException 
    */
   public static void getAndShowTweets(String queryString) throws TwitterException {
      Query query = new Query(queryString);
      QueryResult result = twitter.search(query);

      System.out.println(result.getTweets().size() + " available Tweet(s).");

      result.getTweets().stream().forEach((status) -> {
         System.out.println("@" + status.getUser().getScreenName() + ":" + status.getText());
      });
   }
   
   public static void readStreaming(Configuration cb, String queryString,
                                    double[] southwestCoordinates, double[] northeastCoordinates) {
      StatusListener listener = new StatusListener() {
         @Override
         public void onStatus(Status status) {
            GeoLocation geoLocation = status.getGeoLocation();
            
            if (geoLocation != null) {
               double longitude = geoLocation.getLongitude();
               double latitude = geoLocation.getLatitude();
               
               if (longitude >= southwestCoordinates[0] && longitude <= northeastCoordinates[0] &&
                   latitude >= southwestCoordinates[1] && latitude <= northeastCoordinates[1]) {
                  System.out.println(longitude + "," + latitude + " => " + status.getUser().getName() + " : " + status.getText());
               }
            }
         }
         
         @Override
         public void onDeletionNotice(StatusDeletionNotice statusDeletionNotice) {
            System.out.println("Got a status deletion notice id:" + statusDeletionNotice.getStatusId());
         }
         
         @Override
         public void onTrackLimitationNotice(int numberOfLimitedStatuses) {
            System.out.println("Got track limitation notice:" + numberOfLimitedStatuses);
         }

         @Override
         public void onScrubGeo(long userId, long upToStatusId) {
            System.out.println("Got scrub_geo event userId:" + userId + " upToStatusId:" + upToStatusId);   
         }

         @Override
         public void onStallWarning(StallWarning warning) {
            System.out.println("Got stall warning:" + warning);
         }
         
         @Override
         public void onException(Exception ex) {
            ex.printStackTrace();
         }
      };
      
      TwitterStream twitterStream = new TwitterStreamFactory(cb).getInstance();
      twitterStream.addListener(listener);
      FilterQuery fq = new FilterQuery(queryString);
      twitterStream.filter(fq);
   }
   
   /**
    * Get the application's access token and get some Tweets with the REST/Streaming APIs.
    * @param args the command line arguments
    * @throws twitter4j.TwitterException
    * @throws java.io.IOException
    */
   public static void main(String[] args) throws TwitterException, IOException {
      AccessToken accessToken = getApplicationAccessToken();
      
      ConfigurationBuilder cb = new ConfigurationBuilder();
      cb.setDebugEnabled(true)
              .setOAuthConsumerKey(CONSUMER_KEY)
              .setOAuthConsumerSecret(CONSUMER_SECRET)
              .setOAuthAccessToken(accessToken.getToken())
              .setOAuthAccessTokenSecret(accessToken.getTokenSecret());
      
      //getAndShowTweets("yverdon");
      
      // Switzerland's coordinates, format {longitude, latitude}
      //double[] southwestCoordinates = {5.956085,45.817851};
      //double[] northeastCoordinates = {10.489254,47.808454};
      // USA's coordinates
      double[] southwestCoordinates = {-124.411668, 24.957884};
      double[] northeastCoordinates = {-66.888435, 49.001895};
      
      readStreaming(cb.build(), "job", southwestCoordinates, northeastCoordinates);
   }
}
