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
// Loads the "leaflet-draw-drag" library, which allows the user to draw and drag polygons on the map with a toolbar.
var drawControl = require('leaflet-draw-drag');
// Loads the "Leaflet.markercluster" library, which is used to automatically group markers on the map.
require('leaflet.markercluster');

var socketConnection, dynamicMap, staticMap, streamingResultsMap, markers, drawControlEditOnly, drawControlFull;
// Used as a locker when the user reconnects to the web socket's server. Since JavaScript is indeed
// an asynchronous language, we need to wait for the disconnection before reconnect.
var deferredWebSocketReconnection = $.Deferred();
// Used as a locker at the initialization of the countries list, because we want to order countries
// by their name before adding them in the select list.
var deferredCountriesLoading = $.Deferred();
// Will containt the "latitude, longitude" coordinates of the rectangle bounding the selected
// country (with all its territories, since a country can have many) or the coordinates of
// the drawn rectangle. The first coordinates is the southwest one, followed by the northwest,
// the northeast and finally the southeast ones.
// This array is sent to the server even if the user selected a country from the drop-down box,
// because it is not possible to forward big data (like the coordinates of all the borders of
// a country) through the web socket system.
var boundingRectangleLatLngs = [];
// Indicates if the user manually drew a rectangle on the map.
var rectangleManuallyDrawn = false;
// If the user selected a country with the drop-down box, this variable will contain all the selected
// country's coordinates, in order to draw a complex polygon representing the country on the map of
// the streaming's results and also in order to check if the received Tweet belong to the country.
// This variable must follow this synthax: [[COORD_POLYGON_1], [COORD_POLYGON_2], ...], where the
// coordinates follow the "latitude, longitude" format.
var selectedCountryCoordinates = [];
// Default values for a customized Leaflet's marker icon.
var LeafResultsIcon = L.Icon.extend({
    options: {
        shadowUrl:      jsRoutes.controllers.Assets.versioned('images/marker-shadow.png').url,
        iconSize:       [25, 41], // size of the icon
        shadowSize:     [41, 41], // size of the shadow
        iconAnchor:     [12, 40], // point of the icon which will correspond to marker's location
        shadowAnchor:   [12, 40], // the same for the shadow
        popupAnchor:    [-3, -76] // point from which the popup should open relative to the iconAnchor
    }
});
// Contains the different marker's icons of each streaming results (there will be several different
// results when the user filled a second keyowrds set).
var markersIcons = {
    "first":    new LeafResultsIcon({iconUrl: jsRoutes.controllers.Assets.versioned('images/marker-icon-first.png').url}),
    "second":   new LeafResultsIcon({iconUrl: jsRoutes.controllers.Assets.versioned('images/marker-icon-second.png').url})
};

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

/*
* Erases each potential drawn polygons of the map.
*/
function erasePolygons(map) {
    // Resets the bounding rectangle's coordinates' array.
    boundingRectangleLatLngs = [];
    rectangleManuallyDrawn = false;
    // Also resets the selected country's full coordinates.
    selectedCountryCoordinates = [];

    // Eareses each existing polygons of the map.
    for (i in map._layers) {
        if (map._layers[i]._path != undefined) {
            try {
                map.removeLayer(map._layers[i]);
            }
            catch(e) {
                console.log("Can't erase '" + map._layers[i] + "' from the map: " + e);
            }
        }
    }
}

/*
* Draws the complex polygon(s) whose coordinates arrays correspond to the given ones
* on the given map.
* Since this function can draw multiple polygons, the coordinates parameters must
* be an array of arrays. Each of these arrays contains the coordinates of one polygon.
* For example: coordinates[[COORD_POLYGON_1], [COORD_POLYGON_2], [COORD_POLYGON_3]].
*
* Parameters:
*   - map: the map object in which the polygons will be drawn.
*   - coordinates: an array of arrays containing each polygon's coordinates as a
*                  [latitude,longitude] format, for example
*                  coordinates[[COORD_POLYGON_1], [COORD_POLYGON_2], [COORD_POLYGON_3]].
*/
function drawPolygons(map, coordinates) {
    // Draws each polygon one by one.
    for (var i = 0, nbPoly = coordinates.length; i < nbPoly; ++i) {
        // Adds the current polygon to the map.
        L.polygon(coordinates[i]).addTo(map);
    }

    // Zooms and fits the map according to the current selected country's bounding box.
    if (selectedCountryCoordinates) {
        map.fitBounds(boundingRectangleLatLngs);
    }
}

/**
* Inverts the coordinates of the given polygon.
* This function is used to invert the Leaflet coordinates (latitude, longitude) of the
* selected country's bounding rectangle, in order to make them compatible with the
* Twitter's APIs (which use the "longitude, latitude" format).
*
* Parameters:
*   - coordinates: the coordinates of the polygone that will be inverted; these
*                  coordinates must follow the following synthax:
*                  [[lat1, long1], [lat2, long2], [lat3, long3], ...], where latitude
*                  and longitude coordinates can be inverted since the function is
*                  generic.
*/
function invertCoordinates(coordinates) {
    var tmp;

    for (var i = 0; i < coordinates.length; ++i) {
        tmp = coordinates[i][0];
        coordinates[i][0] = coordinates[i][1];
        coordinates[i][1] = tmp;
    }
}

/**
* Indicates whether the given point is located (true) or not (false) in the given array
* of polygons representing the selected country.
* This function is directly inspired by the substack's "point-in-polygon" MIT library,
* available on GitHub right here: https://github.com/substack/point-in-polygon.
* More explanations about this algorithm are available right here:
* https://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
*
* Parameters:
*   - latitude: the latitude of the point to check
*   - longitude: the longitude of the point to check
*   - polygonsCoordinates: an array containing the coordinates of each polygons in
*                          which we will check if the point is. This array must be
*                          formatted as the following:
*                          [[COORD_POLYGON_1], [COORD_POLYGON_2], ...], where the
*                          coordinates follow the "latitude, longitude" format.
*/
function isPointInSelectedArea(latitude, longitude, polygonsCoordinates) {
    var inside = false;

    for (var i = 0; i < polygonsCoordinates.length; ++i) {
        for (var j = 0, k = polygonsCoordinates[i].length - 1; j < polygonsCoordinates[i].length; k = j++) {
            var xi = polygonsCoordinates[i][j][0], yi = polygonsCoordinates[i][j][1];
            var xj = polygonsCoordinates[i][k][0], yj = polygonsCoordinates[i][k][1];

            var intersect = ((yi > longitude) != (yj > longitude)) && (latitude < (xj - xi) * (longitude - yi) / (yj - yi) + xi);
            if (intersect) {
                inside = !inside;
            }
        }
    }

    return inside;
}

/**
* Loads all countries contained in the geodata file and appends them in the select list
* of countries of the Search page.
*/
function loadCountriesList() {
    // First converts the shapefile file is GeoJSON and gets the data.
    shp(jsRoutes.controllers.Assets.versioned('geodata/TM_WORLD_BORDERS-0.3').url).then(function(geojson) {
        // Then alphabetically sorts the GeoJSON data by the countries' names.
        geojson.features.sort(function(a, b) {
            var nameA = a.properties.NAME;
            var nameB = b.properties.NAME

            if (nameA < nameB) return -1;
            else if (nameA > nameB) return 1;
            else return 0;
        })

        // Finally adds each country in the select list.
        geojson.features.forEach(function(obj) {
            $('#streamingDefaultArea').append($('<option>', {
                value: obj.properties.NAME,
                text: obj.properties.NAME
            }));
        })
    })
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
    drawControlFull = new L.Control.Draw({
        draw: {
            polyline: false,
            polygon: false,
            circle: false,
            marker: false,
            rectangle: {
                shapeOptions: {
                    color: '#0033ff'
                }
            }
        },
        edit: false
    });
    // Initializes the second draw control, by only allowing the user to update the rectangle.
    drawControlEditOnly = new L.Control.Draw({
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
        // Erases each potential other drawn polygons of the map before drawing the
        // current rectangle.
        erasePolygons(dynamicMap);

        // Saves the rectangle's coordinates.
        boundingRectangleLatLngs = [
            [e.layer._latlngs[0].lat, e.layer._latlngs[0].lng],
            [e.layer._latlngs[1].lat, e.layer._latlngs[1].lng],
            [e.layer._latlngs[2].lat, e.layer._latlngs[2].lng],
            [e.layer._latlngs[3].lat, e.layer._latlngs[3].lng],
        ];

        // Unselect the potential selected country in the countries' list.
        $('#streamingDefaultArea option[value=""]').prop('selected', true);

        drawnItems.addLayer(e.layer);
        drawControlFull.removeFrom(dynamicMap);
        drawControlEditOnly.addTo(dynamicMap);

        // Indicates that the user manully drew a rectangle.
        rectangleManuallyDrawn = true;
    });

    // Occurs when the user updated a rectangle.
    // Saves the rectangle's coordinates.
    dynamicMap.on('draw:edited', function(e) {
        boundingRectangleLatLngs = [
            [e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[0].lat, e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[0].lng],
            [e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[1].lat, e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[1].lng],
            [e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[2].lat, e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[2].lng],
            [e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[3].lat, e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[3].lng],
        ];
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

/**
* Erases all the already-existing polygons of the given map, then draws a polygon
* all around the given country on the given map, by using the TM_WORLD_BORDERS' geodata.
*
* Parameters:
*   - countryName: the name of the country we want to draw a polygon around.
*   - map: the map object in which we will draw the polygon.
*/
function selectCountryOnMap(countryName, map) {
    // Resets the drawing's toolbar in the dynamic map if it is the given map.
    if (map === dynamicMap && rectangleManuallyDrawn) {
        drawControlEditOnly.removeFrom(dynamicMap);
        drawControlFull.addTo(dynamicMap);
    }
    // Erases each potential other drawn polygons on the map before drawing the
    // selected country's borders.
    erasePolygons(map);

    // Deals world's borders data to display a polygon on the selected country.
    // First converts the shapefile file is GeoJSON and gets the data.
    shp(jsRoutes.controllers.Assets.versioned('geodata/TM_WORLD_BORDERS-0.3').url).then(function(geojson) {
        // Then searchs for the right selected country.
        geojson.features.forEach(function(obj) {
            if (obj.properties.NAME == countryName) {
                // Will contain the temporary coordinates of the current territory.
                var tmp = new Array();
                // This array will contain the maximum northeast and minimum southwest coordinates
                // of a rectangle polygon bounding all the selected country's territories (since
                // the current country can have several different zones.), in order to properly
                // zoom and fit the map on it and also to give the server this rectangle area.
                var maxMinCoordinates = [];

                // Once the country has been found, there are two cases:
                //    1. the country owns only one territory (like Switzerland): Polygon type.
                //    2. the country owns multiple territories (like France => France and Corsica): MultiPolygon type.
                // We have to differenciate both types, because of the structures, which are not the same.
                if (obj.geometry.type == "Polygon") {
                    // Initializes the coordinates of the country's rectangle.
                    maxMinCoordinates = [
                        [obj.geometry.coordinates[0][0][1], obj.geometry.coordinates[0][0][0]],
                        [obj.geometry.coordinates[0][0][1], obj.geometry.coordinates[0][0][0]]
                    ]

                    // Puts each polygon-country's coordinates in the temporary array.
                    // Since latitude and longitude are inverted in Leaflet, we have to invert them here.
                    obj.geometry.coordinates[0].forEach(function(coord) {
                        // Checks if the current coordinates are smaller/bigger than the maximum/minimum
                        // current coordinates.
                        if (coord[0] < maxMinCoordinates[0][1]) {
                            maxMinCoordinates[0][1] = coord[0];
                        } else if (coord[0] > maxMinCoordinates[1][1]) {
                            maxMinCoordinates[1][1] = coord[0];
                        }

                        if (coord[1] < maxMinCoordinates[0][0]) {
                            maxMinCoordinates[0][0] = coord[1];
                        } else if (coord[1] > maxMinCoordinates[1][0]) {
                            maxMinCoordinates[1][0] = coord[1];
                        }

                        tmp.push([coord[1], coord[0]]);
                    })

                    // Draws the polygon on the map and zooms on it.
                    L.polygon(tmp).addTo(map);
                    map.fitBounds(tmp);
                    // Add the country's coordinates in the saved global variable.
                    selectedCountryCoordinates.push(tmp);
                } else if (obj.geometry.type == "MultiPolygon") {
                    // Initializes the coordinates of the country's rectangle.
                    maxMinCoordinates = [
                        [obj.geometry.coordinates[0][0][0][1], obj.geometry.coordinates[0][0][0][0]],
                        [obj.geometry.coordinates[0][0][0][1], obj.geometry.coordinates[0][0][0][0]]
                    ];

                    // Iterates over each country's territories.
                    for (var i = 0; i < obj.geometry.coordinates.length; ++i) {
                        // Adds each territory one by one on the temporary array.
                        for (var j = 0; j < obj.geometry.coordinates[i][0].length; ++j) {
                            // Checks if the current coordinates are smaller/bigger than the maximum/minimum
                            // current coordinates.
                            if (obj.geometry.coordinates[i][0][j][0] < maxMinCoordinates[0][1]) {
                                maxMinCoordinates[0][1] = obj.geometry.coordinates[i][0][j][0];
                            } else if (obj.geometry.coordinates[i][0][j][0] > maxMinCoordinates[1][1]) {
                                maxMinCoordinates[1][1] = obj.geometry.coordinates[i][0][j][0];
                            }

                            if (obj.geometry.coordinates[i][0][j][1] < maxMinCoordinates[0][0]) {
                                maxMinCoordinates[0][0] = obj.geometry.coordinates[i][0][j][1];
                            } else if (obj.geometry.coordinates[i][0][j][1] > maxMinCoordinates[1][0]) {
                                maxMinCoordinates[1][0] = obj.geometry.coordinates[i][0][j][1];
                            }

                            tmp.push([obj.geometry.coordinates[i][0][j][1], obj.geometry.coordinates[i][0][j][0]]);
                        }

                        // Adds each territory as a polygon to the map.
                        L.polygon(tmp).addTo(map);
                        // Add the coordinates of the current country's territory in the saved global variable.
                        selectedCountryCoordinates.push(tmp);
                        tmp = [];
                    }

                    // Zooms and fits the map on the maximum got northeast and minumum got southwest coordinates.
                    map.fitBounds(maxMinCoordinates);
                }

                // Set the selected country's coordinates as the coordinates of the bounding rectangle.
                boundingRectangleLatLngs = [
                    maxMinCoordinates[0],
                    [maxMinCoordinates[1][0], maxMinCoordinates[0][1]],
                    maxMinCoordinates[1],
                    [maxMinCoordinates[0][0], maxMinCoordinates[1][1]]
                 ];

                return;
            }
        })
    })
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
            deferredWebSocketReconnection.resolve("alreadyClosed");
        }

        // Opens a web socket's connection with the server once the deferred
        // object has been resolved.
        deferredWebSocketReconnection.done(function(value) {
            console.log("Initializing web socket's connection...")
            // Gets the URL of the WebSocket's entity, by reversing the routing process
            // and by using the jsRoutes object declared in the "search.scala.html" view.
            socketConnection = new WebSocket(jsRoutes.controllers.SearchController.streamingSocket().webSocketURL());

            socketConnection.onopen = function() {
                console.log("Socket connection successfully opened!");
            }

            socketConnection.onclose = function() {
                console.log("Socket connection closed.");
                deferredWebSocketReconnection.resolve("closed");
            }

            // If we received an error, this means the user is not connected
            // anymore, or not connected at all so we redirect him to the
            // logout page. Other errors indeed just close the web socket
            // connection.
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

                            // Draws the manually drawn rectangle on the map of the streaming's results if the user
                            // manually drew the rectangle.
                            if (rectangleManuallyDrawn) {
                                drawPolygons(streamingResultsMap, [boundingRectangleLatLngs]);
                            // Otherwise draws each selected country's territories on the map of the streaming's results.
                            } else {
                                drawPolygons(streamingResultsMap, selectedCountryCoordinates);
                            }

                            // Since the Leaflet library uses the "latitude,longitude" format for coordinates while the
                            // Twitter's APIs use the "longitude,latitude" format, we have to invert coordinates of the
                            // bounding rectangle before sending it.
                            invertCoordinates(boundingRectangleLatLngs);

                            console.log("Streaming process successfully initialized! Asking the server to begin to stream...");
                            socketConnection.send(JSON.stringify({
                                "messageType": "readyToStream",
                                "firstKeywords": getAndFormatKeywords("first"),
                                "secondKeywords": getAndFormatKeywords("second"),
                                "coordinates": boundingRectangleLatLngs,
                                "language": $("#language option:selected").val()
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

                            // Adds the new Tweet on the map if the user manually selected the rectangle on the map or if the
                            // Tweet belongs to the selected country's territory (since it wasn't possible to send the entire
                            // massive coordinates array through the network).
                            if (rectangleManuallyDrawn || isPointInSelectedArea(data.latitude, data.longitude, selectedCountryCoordinates)) {
                                // Adds the new Tweet on the map and displays it in the results panel.
                                // The Leaflet.markercluster library will automatically group Tweets on the map.
                                markers.addLayer(L.marker([data.latitude, data.longitude], {icon: markersIcons[data.keywordsSet]}));
                                $("#tweetsContent").prepend("<div><strong>" + getCurrentTime() + " " + data.user + "</strong>: " + data.content + "<br/></div>")
                            }

                            break;
                        // Occurs when the server stopped the streaming process for reasons.
                        case "stopStreaming":
                            // Stops the streaming process without indicating it to the server (since it is the one which
                            // ask us to stop the process).
                            stopStreaming(false);
                            break;
                    }
                } catch (e) {
                    console.log(e);
                }
            }

            // Reinitializes the deferred object in order to lock it again.
            deferredWebSocketReconnection = $.Deferred();
        })
    } else {
        alert(
            "Your web browser is unfortunately incompatible with the streaming process of GeoTwit.\n\
            Please download the lastest version of Chrome or Firefox in order to make it properly work."
        );
    }
}

/**
* Refresh some of the DOM elements; occurs when the user clicked on the "Stop
* Streaming" button. Can also ask the web socket's server to stop the current
* streaming process, if the parameter is set to yes.
*
* Parameters:
*   - sendSocket: indicates whether the client must send a "stopStreaming"
*                 socket to the server (true) or not (false). If this parameter
*                 is false, it means the server already stopped its process.
*/
function stopStreaming(sendSocket) {
    if (socketConnection) {
        if (sendSocket) {
            socketConnection.send(JSON.stringify({
                "messageType": "stopStreaming"
            }));
        }

        $("#btnStopStreaming").hide();
        $("#btnNewSearch").show();
        $("#streamingResultsTitle").html("This streaming was <strong><u>stopped</u></strong>!")
    }
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
    } else if (boundingRectangleLatLngs.length == 0) {
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
        // Adds each comma-separated OR word to the query.
        var resultString = orField.split(" ").join(",");
    // 3. Only the AND field is set => returns a space-separated string.
    } else if (andField) {
        // Just gets the AND field value, since words are already space-separated.
        resultString = andField;
    }

    return resultString;
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

    // Loads the counties list.
    loadCountriesList();

    // Loads maps.
    loadDynamicMap();
    loadStaticMap();

    $("#streamingDefaultArea").change(function() {
        var selectedCountryName = $("#streamingDefaultArea option:selected").val();
        // Draws a polygon on the selected country on the map.
        selectCountryOnMap(selectedCountryName, dynamicMap);

        // Remove the tooltip of the rectangle's drawing when the user selects
        // a country with the drop-down box.
        if (selectedCountryName) {
            $(".leaflet-draw-draw-rectangle").tooltip("hide");
        } else {
            $(".leaflet-draw-draw-rectangle").tooltip("show");
        }
    });

    $("#startStreamingBtn").click(function() {
        $("#errorStreamingSearch").hide();

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
        // Stops the streaming process and indicates it to the server.
        stopStreaming(true);
    })
})
