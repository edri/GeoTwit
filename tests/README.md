# Test applications used in the project's analysis phase
## leaflet
This application contains a simple map drawed with **Mapbox** imagery and **OpenStreetMap** data all togheter through the **Leaflet** JavaScript library. You can pin some markers and draw rectangles and circles in it. The "js/map.js" file contains all the map's code.  
Just open "index.html" in your web browser and it will work.
## leaflet_countries_borders
This application provides the same functionalities as the **leaflet** one, with the possibility to double-click on a country to draw a polygon all around it.
In order to make the application work, please do the following:
1. `sudo npm install -g browserify`
2. `npm install`
3. Open "index.html" in your web browser.
## twitter4jDesktop
This is a simple Java application in which you can search for Tweets or subscribe to the Twitter's Streaming API (by default).  
Just compile the application, launch "Twitter4j.java" and follow the output instructions.
## leafletAndTwitter4J
This contains two applications: **twitter4JWeb**, which is a Java application containing the **twitter4jDesktop** code and a websockets server used to communicate with the second application **leafletAndTwitter**. This one is a JavaScript application displaying the received Tweets from the websocket server in a map. The well-named "js/websocket.js" file contains the websocket client part.    
Is order to correctly use them, start the Java server (having already configured beforeheand GlassFish server and NetBeans) and then open the "leafletAndTwitter/index.html" file in your web browser. Then just click the "Start Streaming" button in the web application.