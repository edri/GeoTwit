/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */


import java.util.Observable;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 *
 * @author miguel
 */
public class StreamingStatsThread extends Observable implements Runnable {
   private final String queryString;
   private final long timeBetweenStats;
   private final Streaming streaming;
   private final Thread thread;
   
   public StreamingStatsThread(String queryString, long timeBetweenStats, Streaming streaming) {
      this.queryString = queryString;
      this.timeBetweenStats = timeBetweenStats;
      this.streaming = streaming;      
      thread = new Thread(this);
      thread.start();
   }
   
   @Override
   public void run() {
      long nbReceivedTweets, nbTweetsWithGeoloc, nbTweetsWithRightGeoloc;
      double percentsGeoloc, percentRightGeoloc;
      
      while (true) {
         try {
            Thread.sleep(timeBetweenStats);
            // Get Streaming's stats data.
            nbReceivedTweets = streaming.getNbReveivedTweets();
            nbTweetsWithGeoloc = streaming.getNbTweetsWithLocation();
            nbTweetsWithRightGeoloc = streaming.getNbTweetsWithRightLocation();
            // Then reset data for the next analysis.
            streaming.resetData();
            
            // Calculate and display stats.
            percentsGeoloc = Math.round(nbTweetsWithGeoloc * (100.0 / nbReceivedTweets) * 100) / (double)100;
            percentRightGeoloc = Math.round(nbTweetsWithRightGeoloc * (100.0 / nbReceivedTweets) * 100) / (double)100;
            System.out.println("I received " + nbReceivedTweets + " Tweets in " + 
                               timeBetweenStats / 1000 + " seconds" + ", including " + 
                               nbTweetsWithGeoloc + " ones WITH geolocalion tags and " + 
                               nbTweetsWithRightGeoloc + " ones with the wanted geolocation.");
            System.out.println("This means " + percentsGeoloc + " % of the received " + 
                               "Tweets with the \"" + queryString + "\" tag(s) owned a" +
                               " geolocation tag and " + percentRightGeoloc + " % " + 
                               "contained the desired location.");
         } catch (InterruptedException ex) {
            Logger.getLogger(StreamingStatsThread.class.getName()).log(Level.SEVERE, null, ex);
         }
      }
   }
}
