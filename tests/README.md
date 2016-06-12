# Test applications used in the project's analysis phase
## leaflet
This application contains a simple map drawn with **Mapbox**'s imagery and **OpenStreetMap**'s data all together through the **Leaflet** JavaScript library. In this basic application, you can pin markers and draw rectangles and circles on a map. The "js/map.js" file contains all the map's code.  
Just open "index.html" in your web browser and it will work.
## leaflet_countries_borders
This application provides the same functionalities as the **leaflet** one, with the possibility to double-click on a country to draw a polygon all around it.  
In order to make the application work, please do the following:

1. `sudo npm install -g browserify`
2. `npm install`
3. Open "index.html" in your web browser.

## twitter4jDesktop
This is a simple Java application in which you can search for Tweets or subscribe to the Twitter's Streaming API (by default) or ask the REST API.  
In order to use this application please do the following: uncomment the country in which you want to search Tweets in the “main” of the “Twitter4j.java”, then compile the application, launch "Twitter4j.java" and follow the output instructions.
## leafletAndTwitter4J
This application receives streams of Tweets and display them on a map.
It contains two applications: **twitter4JWeb**, which is a Java application containing the **twitter4jDesktop** code and a web sockets server used to communicate with the second application **leafletAndTwitter**. This one is a JavaScript application displaying the received Tweets from the web socket server in a map. The well-named "js/websocket.js" file contains the web socket client part.  
Is order to correctly use them, please do the following:

1. Uncomment the country in which you want to search Tweets in the beginning of the “readStreaming” method in the “Streaming.java” file of the “twitter4jWeb” application.
2. Write the keyword you want to search at the end of the “initializeConfiguration” method in the “Streaming.java” file.
3. Start the Java server “twitter4jWeb” (having already configured beforehand GlassFish server and NetBeans).
4. Open the "leafletAndTwitter/index.html" file in your web browser when the server is correctly started.
5. Then just click the "Start Streaming" button in the web application to start the streaming.
