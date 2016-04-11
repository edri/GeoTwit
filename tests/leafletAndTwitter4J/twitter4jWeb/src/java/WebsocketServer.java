import java.io.IOException;
import java.util.concurrent.ExecutionException;
import javax.faces.bean.ApplicationScoped;
import javax.websocket.OnClose;
import javax.websocket.OnError;
import javax.websocket.OnMessage;
import javax.websocket.OnOpen;
import javax.websocket.Session;
import javax.websocket.server.ServerEndpoint;
import twitter4j.JSONException;
import twitter4j.JSONObject;
import twitter4j.TwitterException;

/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

/**
 *
 * @author miguel
 */
@ApplicationScoped
@ServerEndpoint("/") 
public class WebsocketServer {
   private static Session session;
   private static Streaming streaming;

   public WebsocketServer() throws TwitterException, IOException {
      WebsocketServer.streaming = new Streaming();
   }
   
   public static void sendMessage(String message) throws IOException {
      session.getBasicRemote().sendText(message);
   }
   
   /**
    * @param session
    * @throws java.io.IOException
    * @throws twitter4j.TwitterException
    * @throws java.lang.InterruptedException
    * @throws java.util.concurrent.ExecutionException
    * @OnOpen allows us to intercept the creation of a new session.
    * The session class allows us to send data to the user.
    * In the method onOpen, we'll let the user know that the handshake was 
    * successful.
    */
   @OnOpen
   public void onOpen(Session session) throws IOException, TwitterException, InterruptedException, ExecutionException {
      WebsocketServer.session = session;
      System.out.println(session.getId() + " has opened a connection");
   }

   /**
    * When a user sends a message to the server, this method will intercept the message
    * and allow us to react to it. For now the message is read as a String.
    * @param message
    * @param session
    * @throws twitter4j.TwitterException
    * @throws java.io.IOException
    * @throws java.lang.InterruptedException
    * @throws java.util.concurrent.ExecutionException
    */
   @OnMessage
   public void onMessage(String message, Session session) throws TwitterException, IOException, InterruptedException, ExecutionException, JSONException {
      if (WebsocketServer.session == session) {
         System.out.println("Message from " + session.getId() + ": " + message);
         
         JSONObject data = new JSONObject(message);
         String messageType = data.getString("message");

         switch(messageType) {
            case "startStreaming":
               streaming.initializeToken();
               break;
            case "accessTokenPin":
               streaming.createApplicationAccessToken(data.getString("pin"));
               break;
         }
      }
   }
 
   /**
    * The user closes the connection.
    * 
    * Note: you can't send messages to the client from this method
    * @param session
    */
   @OnClose
   public void onClose(Session session) {
      if (WebsocketServer.session == session) {
         System.out.println("Session " +session.getId()+" has ended");
      }
   }

   @OnError
   public void onError(Throwable t) {}
}
