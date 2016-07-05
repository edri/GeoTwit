var INIT_MAP_CENTER = [37.360843495760044, -94.833984375];
var INIT_MAP_ZOOM = 4;
var MAP_LAYER_URL = "http://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png";
var MAP_MAX_ZOOM = 20;
var MAP_ATTRIBUTION = "&copy; <a href='http://www.openstreetmap.org/copyright'>OpenStreetMap</a>, Tiles courtesy of <a href='http://hot.openstreetmap.org/' target='_blank'>Humanitarian OpenStreetMap Team</a>";
var SUCCESS_STATUS = "success";
var FIRST_KEYWORD_NOT_SET = "firstKeywordNotSet";
var LOCATION_NOT_SELECTED = "locationNotSelected";
// "require" code is normally only usable in Node.js, but we bundle it with the amazing "browserify" library!
// If you update this file you have to install "browserify" (npm install -g browserify) and then just have
// to type "browserify public/javascripts/search.js -o public/javascripts/search-bundle.js".
// Load the "leaflet-draw-drag" library, which allows the user to draw and drag polygons on the map with a toolbar.
var drawControl = require('leaflet-draw-drag');
// Load the "Leaflet.markercluster" library, which is used to automatically group markers on the map.
require('leaflet.markercluster');
var socketConnection, dynamicMap, staticMap, streamingResultsMap, rectangleLatLngs, markers;
// Used as a locker when the user reconnects to the web socket's server. Since JavaScript is indeed
// an asynchronous language, we need to wait for the disconnection before reconnect.
var deferred = $.Deferred();

/**
* Returns the current time as a "[HH:MM:SS]" format.
*/
function getCurrentTime() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var s = d.getSeconds();

    if (h < 10) h = "0" + h;
    if (m < 10) m = "0" + m;
    if (s < 10) s = "0" + s;

    return "[" + h + ":" + m + ":" + s + "]";
}

/**
* Loads all elements related to the dynamic map.
*/
function loadDynamicMap() {
    // Changes a Loaflet.draw's default text.
    L.drawLocal.edit.handlers.edit.tooltip.text = 'Drag handles, or marker to edit feature, then press the <strong><u>SAVE</u></strong> button.';

    // Set dynamic map's values (coordinates and zoom's value).
    // Also load the maps' imagery with OpenStreetMap's hot imagery.
    // You can find a list of imagery providers right here: https://leaflet-extras.github.io/leaflet-providers/preview/.
    dynamicMap = new L.Map("dynamicMap", {center: INIT_MAP_CENTER, zoom: INIT_MAP_ZOOM})
        .addLayer(new L.tileLayer(MAP_LAYER_URL, {
            maxZoom: MAP_MAX_ZOOM,
            attribution: MAP_ATTRIBUTION
        }));

    // Initializes the drawn item in order to store the shapes drawn by the user
    // with the Leaflet.draw library.
    var drawnItems = new L.FeatureGroup().addTo(dynamicMap);
    // The map can have one of the two following draw controls:
    //  - drawControlFull: allows the user to draw a rectangle on the map.
    //  - drawControlEditOnly: allows the user to update the drawn rectangle.
    // Initializes first the draw control, by only allowing the user to draw rectangles.
    var drawControlFull = new L.Control.Draw({
        draw: {
            polyline: false,
            polygon: false,
            circle: false,
            marker: false,
            rectangle: {
                shapeOptions: {
                    color: '#ff9900'
                }
            }
        },
        edit: false
    });
    // Initializes the second draw control, by only allowing the user to update the rectangle.
    var drawControlEditOnly = new L.Control.Draw({
        edit: {
            featureGroup: drawnItems,
            remove: false
        },
        draw: false
    });
    // Adds the first draw control to the map so the user can draw a rectangle.
    dynamicMap.addControl(drawControlFull);

    // Occurs when the user drew a new rectangle.
    // Saves the coordinates, removes the first draw control and adds the second one to the map, so the user can update the drawn rectangle.
    dynamicMap.on('draw:created', function(e) {
        // Saves the rectangle southwest and northeast's coordinates.
        rectangleLatLngs = {
            southwest: [
                e.layer._latlngs[0].lng,
                e.layer._latlngs[0].lat
            ],
            northeast: [
                e.layer._latlngs[2].lng,
                e.layer._latlngs[2].lat
            ]
        };

        drawnItems.addLayer(e.layer);
        drawControlFull.removeFrom(dynamicMap);
        drawControlEditOnly.addTo(dynamicMap)
    });

    // Occurs when the user updated a rectangle.
    // Saves the rectangle's coordinates.
    dynamicMap.on('draw:edited', function(e) {
        // Saves the rectangle southwest and northeast's coordinates.
        rectangleLatLngs = {
            southwest: [
                e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[0].lng,
                e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[0].lat
            ],
            northeast: [
                e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[2].lng,
                e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[2].lat
            ]
        };
    });

    // Adds a Bootstrap's tooltip on the button that allows the user to draw a rectangle.
    $(".leaflet-draw-draw-rectangle").attr({
        "data-placement": "right",
        "data-trigger": "manual",
        title: "You can draw a rectangle by clicking on this button."
    });
    $(".leaflet-draw-draw-rectangle").tooltip("show");

    // This tooltip is removed when the user moves the cursor hover the button.
    $(".leaflet-draw-draw-rectangle, .tooltip").hover(function() {
        $(".leaflet-draw-draw-rectangle").tooltip("hide");
    })
}

/**
* Loads all elements related to the static map.
*/
function loadStaticMap() {
    staticMap = new L.Map("staticMap", {center: INIT_MAP_CENTER, zoom: INIT_MAP_ZOOM})
        .addLayer(new L.tileLayer(MAP_LAYER_URL, {
            maxZoom: MAP_MAX_ZOOM,
            attribution: MAP_ATTRIBUTION
        }));
}

/**
* Loads all elements related to the map of the streaming's results.
*/
function loadStreamingResultsMap() {
    streamingResultsMap = new L.Map("streamingResultsMap", {center: INIT_MAP_CENTER, zoom: INIT_MAP_ZOOM})
        .addLayer(new L.tileLayer(MAP_LAYER_URL, {
            maxZoom: MAP_MAX_ZOOM,
            attribution: MAP_ATTRIBUTION
        }));

    // Adds the cluster goup object as a layer to the map of the streaming's results,
    // in order to automatically group markers with the Leaflet.markercluster library.
    markers = L.markerClusterGroup();
    streamingResultsMap.addLayer(markers);
}

/*
* Draws the rectangle whose coordinates corresponds to the given ones on the
* given map.
*/
function drawRectangle(map, northeastCoordinates, southwestCoordinates) {
    // Gets right-formatted bounds (since latitude and longitude are inverted in
    // Leaflet) and draws the rectangle on the map.
    var bounds = [[southwestCoordinates[1], southwestCoordinates[0]], [northeastCoordinates[1], northeastCoordinates[0]]];
    L.rectangle(bounds, {color: "#ff7800", weight: 1}).addTo(map);
    // Zooms the map to the rectangle's bounds.
    map.fitBounds(bounds);
}

/**
* Validates the streaming form's fields.
* Returns either 'true' if everything is valid or 'false' otherwise.
*/
function streamingFieldsValidation() {
    var status = SUCCESS_STATUS;

    // There must be at least one keyword.
    if (!$("#streamingFirstKeywordSetOr").val() && !$("#streamingFirstKeywordSetAnd").val()) {
        status = FIRST_KEYWORD_NOT_SET;
    // The user mast have selected an area on the map.
    } else if (!rectangleLatLngs && !$("#streamingDefaultArea").val()) {
        status = LOCATION_NOT_SELECTED;
    }

    return status;
}

/**
* Gets the string representing the track (query) parameter of the Twitter's streaming request,
* according to the values of the user's AND and OR inputs.
* In the Twitter's API, AND parameters take priority over OR parameters (for example
* "dog AND eating OR dog AND drinking" will be interpreted as "(dog AND eating) OR (dog AND drinking)").
* In the query, a space (" ") is interpreted as a AND, and a comma (",") will be interpreted as
* a OR. Parentheses are not supported.
* Here are some example of output, according to the input fields:
*   : AND: ""               OR: ""                  => ""
*   - AND: "job engineer"   OR: ""                  => "job engineer"
*   - AND: ""               OR: "job engineer"      => "job,engineer"
*   - AND: "job"            OR: "engineer nursing"  => "job engineer,job nursing"
*   - AND: "job anybody"    OR: "engineer"          => "job anybody engineer"
*   - AND: "job anybody"    OR: "engineer nursing"  => "job anybody engineer, job anybody nursing"
*   - AND: "job"            OR: "engineer"          => "job engineer"
*
* Parameters:
*   - keywordsSetNumber: indicates the keyword set we are working on => "first" for the first
*                        one, "second" for the second one.
*/
function getAndFormatKeywords(keywordsSetNumber) {
    var orField, andField;
    var resultString = "";

    // Gets the right fields, according to the given parameter.
    switch (keywordsSetNumber) {
        case "first":
            orField = $("#streamingFirstKeywordSetOr").val();
            andField = $("#streamingFirstKeywordSetAnd").val();
            break;
        case "second":
            orField = $("#streamingSecondKeywordSetOr").val();
            andField = $("#streamingSecondKeywordSetAnd").val();
            break;
        // Returns an empty string if the given parameter doesn't match with existing fields.
        default:
            return resultString;
    }

    // There are four possible cases:
    //      1. The OR and AND fields are set => returns a space-and-comma-separated string.
    //      2. Only the OR field is set => returns a comma-separated string.
    //      3. Only the AND field is set => returns a space-separated string.
    //      4. Neither the OR and AND fields are set => returns an empty string.
    // 1. The OR and AND fields are set => returns a space-and-comma-separated string.
    if (orField && andField) {
        // Gets each word of the OR field.
        var orWords = orField.split(" ");

        // Iterates over each OR word and adds it to the end of the AND fields.
        for (var i = 0, len = orWords.length; i < len; ++i) {
            resultString += andField + " " + orWords[i];
            if (i < len - 1) resultString += ",";
        }
    // 2. Only the OR field is set => returns a comma-separated string.
    } else if (orField) {
        var orWords = orField.split(" ");

        // Adds each comma-separated OR word to the query.
        for (var j = 0, lenOr = orWords.length; j < lenOr; ++j) {
            resultString += orWords[j];
            if (j < lenOr - 1) resultString += ",";
        }
    // 3. Only the AND field is set => returns a space-separated string.
    } else if (andField) {
        // Just gets the AND field value, since words are already space-separated.
        resultString = andField;
    }

    return resultString;
}

/**
* Asks the web socket's server to stop the current streaming process, then refresh
* some of the DOM elements; occurs when the user clicked on the "Stop Streaming"
* button.
*/
function stopStreaming() {
    if (socketConnection) {
        socketConnection.send(JSON.stringify({
            "messageType": "stopStreaming"
        }));

        $("#btnStopStreaming").hide();
        $("#btnNewSearch").show();
        $("#streamingResultsTitle").text("This streaming was stopped!")
    }
}

/**
* Initializes a web socket connection with the server; occurs when the user
* clicked on the "Start Streaming!" button.
*/
function initWebSocket() {
    // Checks if the user's web browser is compatible with web sockets.
    if ("WebSocket" in window) {
        // If a web socket's connection is already open, we close it first in
        // order to create a new one and thus to ensure the user is still
        // connected to the application.
        // We have to wait for the socket to properly be closed before opening
        // a new connection.
        if (socketConnection) {
            console.log("Closing socket connection...");
            // When the web socket will be correctly closed, it will trigger the
            // "onclose" method, which will resolve the deferred object.
            socketConnection.close();
        } else {
            // If there is no opened connection yet, just resolve the deferred
            // object in order to be able to open it.
            deferred.resolve("socketNotOpenedYet");
        }

        // Opens a web socket's connection with the server once the deferred
        // object has been resolved.
        deferred.done(function(value) {
            console.log("Initializing web socket's connection...")
            // Gets the URL of the WebSocket's entity, by reversing the routing process
            // and by using the jsRoutes object declared in the "search.scala.html" view.
            socketConnection = new WebSocket(jsRoutes.controllers.SearchController.streamingSocket().webSocketURL());

            socketConnection.onopen = function() {
                console.log("Socket connection successfully opened!");
            }

            socketConnection.onclose = function() {
                console.log("Socket connection closed.");
                deferred.resolve("closed");
            }

            // If we received an error, this means the user is not connected
            // anymore, or not connected at all so we redirect him to the
            // logout page.
            socketConnection.onerror = function(error) {
                alert("Your session expired, you are going to be disconnected.");
                window.location.replace(jsRoutes.controllers.HomeController.logout().url);
            };

            // Log messages from the server
            socketConnection.onmessage = function(e) {
                try {
                    // Try to parse received data to JSON.
                    var data = JSON.parse(e.data);

                    // Do some actions, depending on the received data message's type.
                    switch (data.messageType) {
                        // Received if the streaming process has been successfully
                        // opened; displays the result components and asks the server
                        // to begin the stream.
                        case "successfulInit":
                            $("#searchContent").hide();
                            $("#streamingResults").fadeIn();
                            loadStreamingResultsMap();
                            drawRectangle(streamingResultsMap, rectangleLatLngs.northeast, rectangleLatLngs.southwest)

                            console.log(getAndFormatKeywords("first"));
                            console.log(getAndFormatKeywords("second"));

                            console.log("Streaming process successfully initialized! Asking the server to begin to stream...");
                            socketConnection.send(JSON.stringify({
                                "messageType": "readyToStream",
                                "firstKeywords": getAndFormatKeywords("first"),
                                "secondKeywords": getAndFormatKeywords("second"),
                                "northeastCoordinates": rectangleLatLngs.northeast,
                                "southwestCoordinates": rectangleLatLngs.southwest
                            }));
                            break;
                        // Occurs if the user's session expired during the streaming
                        // process.
                        case "sessionExpired":
                            alert("Your session expired, you are going to be disconnected.");
                            window.location.replace(jsRoutes.controllers.HomeController.logout().url);
                            break;
                        // Occurs when new Tweet's data are coming from the server.
                        case "newTweet":
                            // Shows the reveived tweets panel if not already done.
                            if ($("#noTweetReceivedText").is(":visible")) {
                                $("#noTweetReceivedText").hide();
                                $("#tweetsContent").fadeIn();
                            }

                            // Adds the new Tweet on the map and displays it in the results panel.
                            // The Leaflet.markercluster library will automatically group Tweets on the map.
                            markers.addLayer(L.marker([data.latitude, data.longitude]));
                            $("#tweetsContent").prepend("<div><strong>" + getCurrentTime() + " " + data.user + "</strong>: " + data.content + "<br/></div>")

                            break;
                    }
                } catch (e) {
                    console.log(e);
                }
            }

            // Reinitializes the deferred object in order to lock it again.
            deferred = $.Deferred();
        })
    } else {
        alert(
            "Your web browser is unfortunately incompatible with the streaming process of GeoTwit.\n\
            Please download the lastest version of Chrome or Firefox in order to make it properly work."
        );
    }
}

/**
* Occurs when the page successfully loaded all DOM elements.
*/
$(document).ready(function() {
    // Since we have moved the different Leflet library's files, we have to indicate
    // the system where it can find the Leaflet's images.
    L.Icon.Default.imagePath = jsRoutes.controllers.Assets.versioned('images').url;

    // Enable tabs' actions once the page has been successfully loaded.
    $('#searchTabs a, #streamingResultsTabs a').click(function (e) {
        e.preventDefault();
        $(this).tab('show');
    })

    // This event is triggered when the user presses the "Static Mode" tab in
    // order to avoid a map's display bug (since the map of this tab is hidden
    // by default, the system does not know how to react).
    // It simply refresh the static map.
    $('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
        staticMap.invalidateSize(false);
    })

    // Loads maps.
    loadDynamicMap();
    loadStaticMap();

    $("#startStreamingBtn").click(function() {
        // Validates the search fields.
        var fieldsValidationstatus = streamingFieldsValidation();

        // If all fields were valid, starts the streaming process.
        if (fieldsValidationstatus === SUCCESS_STATUS) {
            initWebSocket();
        // If there was an error, displays it.
        } else {
            var errorText;

            switch (fieldsValidationstatus) {
                case FIRST_KEYWORD_NOT_SET:
                    errorText = "Please fill at least one keyword of the first set.";
                    break;
                case LOCATION_NOT_SELECTED:
                    errorText = "Please select a location on the map.";
                    break;
                default:
                    errorText = "An error occured, please retry in a while.";
            }

            $("#errorStreamingSearch").html("<span aria-hidden='true' class='fa fa-exclamation-circle'></span> " + errorText)
            $("#errorStreamingSearch").fadeIn();
        }
    })

    $("#btnStopStreaming").click(function() {
        stopStreaming();
    })
})
