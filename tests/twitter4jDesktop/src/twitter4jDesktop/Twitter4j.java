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
import twitter4j.TwitterException;

/**
 *
 * @author miguel
 */
public class Twitter4j {
   /**
    * Read user's input and return the Twitter's tags the user want to search.
    * @return the Twitter's tags the user want to search
    * @throws IOException 
    */
   public static String readTags() throws IOException {
      BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
      boolean success = false;
      String filter = "";
      
      do {
         System.out.print("Please enter some tags to search: ");
         
         filter = br.readLine();
         
         /*if (filter.isEmpty()) {
            System.out.println("Please enter at least one character.");
         } else {*/
            success = true;
         //}
      } while(!success);
      
      return filter;
   }
   
   /**
    * @param args the command line arguments
    * @throws twitter4j.TwitterException
    * @throws java.io.IOException
    * @throws java.lang.InterruptedException
    * @throws java.util.concurrent.ExecutionException
    */
   public static void main(String[] args) throws TwitterException, IOException, InterruptedException, ExecutionException {
      MainExecution mainExecution = new MainExecution();
      
      //mainExecution.getAndShowTweets("yverdon");
      
      // Switzerland's coordinates, format {longitude, latitude}
      //double[] southwestCoordinates = {5.956085, 45.817851};
      //double[] northeastCoordinates = {10.489254, 47.808454};
      // USA's coordinates
      //double[] southwestCoordinates = {-124.411668, 24.957884};
      //double[] northeastCoordinates = {-66.888435, 49.001895};
      // UK's coordinates
      double[] southwestCoordinates = {-8.306947, 49.696022};
      double[] northeastCoordinates = {1.801128, 59.258967};
      
      mainExecution.readStreaming(readTags(), southwestCoordinates, northeastCoordinates, false);
   }
}
