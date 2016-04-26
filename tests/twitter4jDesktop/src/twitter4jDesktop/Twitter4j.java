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
    * @param args the command line arguments
    * @throws twitter4j.TwitterException
    * @throws java.io.IOException
    * @throws java.lang.InterruptedException
    * @throws java.util.concurrent.ExecutionException
    */
   public static void main(String[] args) throws TwitterException, IOException, InterruptedException, ExecutionException {
      Streaming mainExecution = new Streaming();
      
      //mainExecution.getAndShowTweets("yverdon");
      
      // Switzerland's coordinates, format {longitude, latitude}
      //double[] southwestCoordinates = {5.956085, 45.817851};
      //double[] northeastCoordinates = {10.489254, 47.808454};
      // USA's coordinates
      double[] southwestCoordinates = {-124.411668, 24.957884};
      double[] northeastCoordinates = {-66.888435, 49.001895};
      // UK's coordinates
      //double[] southwestCoordinates = {-8.306947, 49.696022};
      //double[] northeastCoordinates = {1.801128, 59.258967};
      // Italy coordinates
      //double[] southwestCoordinates = {6.6357421875, 47.09805038936004};
      //double[] northeastCoordinates = {18.6328125, 36.577893995157474};
      
      // Read user's entered tags.
      BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
      System.out.print("Please enter some tags to search: ");
      String tags = br.readLine();
      
      mainExecution.readStreaming(tags, southwestCoordinates, northeastCoordinates, false);
   }
}
