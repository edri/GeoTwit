var INIT_MAP_CENTER = [37.360843495760044, -94.833984375];
var INIT_MAP_ZOOM = 4;
var MAP_LAYER_URL = "http://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png";
var MAP_MAX_ZOOM = 20;
var MAP_ATTRIBUTION = "&copy; <a href='http://www.openstreetmap.org/copyright'>OpenStreetMap</a>, Tiles courtesy of <a href='http://hot.openstreetmap.org/' target='_blank'>Humanitarian OpenStreetMap Team</a>";
var DATE_FORMAT = "YYYY-MM-DD";
var SUCCESS_STATUS = "success";
var FIRST_KEYWORD_NOT_SET = "Please fill at least one keyword of the first set.";
var DATE_NOT_SET = "Please fill the range of dates.";
var DATE_NOT_VALID = "At least one of the dates you entered is not valid. Please enter dates as a \"" + DATE_FORMAT + "\" format.";
var FROM_DATE_GREATER_THAN_TO_DATE = "The \"from\" date cannot be greater or equal to the \"to\" date.";
var LOCATION_NOT_SELECTED = "Please select a location on the map.";
var MAX_DAYS_STATIC_SEARCH = 9;
var STREAMING_MODE_IDENTIFIER = "streaming";
var STATIC_MODE_IDENTIFIER = "static";
var FIRST_SUBJECT_LABEL = "First Subject";
var SECOND_SUBJECT_LABEL = "Second Subject";
var FIRST_SUBJECT_COLOR = "rgba(41, 129, 202, 1)";
var FIRST_SUBJECT_TRANSPARENT_COLOR = "rgba(41, 129, 202, 0.4)";
var SECOND_SUBJECT_COLOR = "rgba(255, 111, 39, 1)";
var SECOND_SUBJECT_TRANSPARENT_COLOR = "rgba(255, 111, 39, 0.4)";
// The number of Tweets per minutes that can be considered as a good speed.
var GOOD_SPEED = 30;
// The values of the color of the good speed rate. You can find more information about HSL colors here:
// http://www.w3schools.com/colors/colors_hsl.asp.
var GOOD_SPEED_HUE_COLOR = 120;
var BAD_SPEED_LIGHTNESS_COLOR = 50;
var GOOD_SPEED_LIGHTNESS_COLOR = 25;
var MAX_DISPLAYED_TWEETS = 100;

// "require" code is normally only usable in Node.js, but we bundle it with the amazing "browserify" library!
// If you update this file you have to install "browserify" (npm install -g browserify) and then just have
// to type "browserify public/javascripts/search.js -o public/javascripts/search-bundle.js".
// Loads the "leaflet-draw-drag" library, which allows the user to draw and drag polygons on the map with a toolbar.
var drawControl = require('leaflet-draw-drag');
// Loads the "Leaflet.markercluster" library, which is used to automatically group markers on the map.
require('leaflet.markercluster');
// Loads the "Chart.js" library, in order to be able to build charts during the streaming process.
var Chart = require('chart.js');
// Loads the "Moment.js" library, which is used to easily format dates.
var moment = require("moment");

var circleLatLngRad, socketConnection, markers, speedInterval, lineChartsUpdateInterval, doughnutBarChartsUpdateInterval,
    chartTotalReceivedTweets, chartTweetsReception, chartPartsOfReceivedTweets, chartWithoutGeolocation, chartWithoutGeolocationCurrent, chartGeolocationComparison;
// Will contain the element of the search and result's maps.
var searchMaps = {
    "dynamicMap": null,
    "staticMap": null
};
var drawControlFull = {
    "dynamicMap": null,
    "staticMap": null
};
var drawControlEditOnly = {
    "dynamicMap": null,
    "staticMap": null
};
var resultMaps = {
    "streaming": null,
    "static": null
}
// Used as a locker when the user reconnects to the web socket's server. Since JavaScript is indeed
// an asynchronous language, we need to wait for the disconnection before reconnect.
var deferredWebSocketReconnection = $.Deferred();
// Used as a locker at the initialization of the countries list, because we want to order countries
// by their name before adding them in the select list.
var deferredCountriesLoading = $.Deferred();
// Will contain the "latitude, longitude" coordinates of the rectangle bounding the selected
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
    "options": {
        "shadowUrl":    jsRoutes.controllers.Assets.versioned('images/marker-shadow.png').url,
        "iconSize":     [25, 41], // size of the icon
        "shadowSize":   [41, 41], // size of the shadow
        "iconAnchor":   [12, 40], // point of the icon which will correspond to marker's location
        "shadowAnchor": [12, 40], // the same for the shadow
        "popupAnchor":  [-3, -76] // point from which the popup should open relative to the iconAnchor
    }
});
// Contains the different marker's icons of each streaming results (there will be several different
// results when the user filled a second keyowrds set).
var markersIcons = {
    "first":    new LeafResultsIcon({iconUrl: jsRoutes.controllers.Assets.versioned('images/marker-icon-first.png').url}),
    "second":   new LeafResultsIcon({iconUrl: jsRoutes.controllers.Assets.versioned('images/marker-icon-second.png').url})
};
// Contains human-understandable queries string of the searchs (for example "dog AND (food OR drink)"),
// in order to display them in the results' page.
var humanQueryString = {
    "first": "",
    "second": ""
};
// Contains the number of received Tweets since the beginning of the current streamings.
// The first elements contain the number of Tweets with geolocation tags, while the
// last ones contain the total number of Tweets (with and without geolocation tag).
var nbReceivedTweets = {
    "first": 0,
    "second": 0,
    "firstTotal": 0,
    "secondTotal": 0
};
// Contains the elapsed time in seconds since the beginning of the streaming(s).
var elapsedTime = 0;

/**
* Converts the given seconds into a "HH:MM:SS" time format with the Moment.js library.
*/
function secondsToHhMmSs(seconds) {
    return moment().startOf('day').seconds(seconds).format('HH:mm:ss');
}

/**
* Recursively clones the given object and return the clone. If a non-object value is passed in, that value is returned.
* I found this function here: http://heyjavascript.com/4-creative-ways-to-clone-objects/.
*/
function cloneObject(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    // Gives "temp" the original obj's constructor.
    var temp = obj.constructor();
    for (var key in obj) {
        temp[key] = cloneObject(obj[key]);
    }

    return temp;
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
*   - readFileMode: indicates whether the user imported a file in the application (true) or not (false - default),
*                   in order to zoom on the right coordinates.
*/
function drawPolygons(map, coordinates, readFileMode = false) {
    // Draws each polygon one by one.
    for (var i = 0, nbPoly = coordinates.length; i < nbPoly; ++i) {
        // Adds the current polygon to the map.
        L.polygon(coordinates[i]).addTo(map);
    }

    // Zooms and fits the map according to the current selected country's bounding box.
    if (readFileMode) {
        map.fitBounds(coordinates[0]);
    } else {
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
* Loads all countries contained in the geodata file and appends them to the drop-down list
* of countries of the Search page.
*/
function loadCountriesList() {
    // First converts the shapefile file is GeoJSON and gets the data.
    shp(jsRoutes.controllers.Assets.versioned('data/geodata/TM_WORLD_BORDERS-0.3').url).then(function(geojson) {
        // Then alphabetically sorts the GeoJSON data by the countries' names.
        geojson.features.sort(function(a, b) {
            var nameA = a.properties.NAME;
            var nameB = b.properties.NAME

            if (nameA < nameB) return -1;
            else if (nameA > nameB) return 1;
            else return 0;
        });

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
* Loads all languages contained in the Json file and appends them to the drop-down list
* of languages in the Search page.
*/
function loadLanguagesList() {
    // Reads the JSON file containing all languages.
    $.getJSON(jsRoutes.controllers.Assets.versioned('data/languages.json').url, function(data) {
        // Then ensures the languages are correctly ordered by their text values.
        data.languages.sort(function(a, b) {
            if (a.text < b.text) return -1;
            else if (a.text > b.text) return 1;
            else return 0;
        });

        // Finally adds each language in the languages' drop-down lists.
        $.each(data.languages, function(index, language) {
            $("#staticLanguage, #dynamicLanguage").append($('<option>', {
                value: language.value,
                text: language.text
            }));
        });
    })
}

/**
* Loads all elements related to the given search map's ID.
*
* Parameters:
*   - mapId: the string ID (corresponding to the HTML id of the element) of the map to load.
*   - hasRectangle: indicates whether the user can draw a rectangle on the map (true) or not (false); the user cannot draw rectangles AND circles.
*   - hasCircle: indicates whether the user can draw a circle on the map (true) or not (false); the user cannot draw rectangles AND circles.
*/
function loadSearchMap(mapId, hasRectangle, hasCircle) {
    // Changes a Loaflet.draw's default text.
    L.drawLocal.edit.handlers.edit.tooltip.text = 'Drag handles, or marker to edit feature, then press the <strong><u>SAVE</u></strong> button.';

    // Set search map's values (coordinates and zoom's value).
    // Also load the maps' imagery with OpenStreetMap's hot imagery.
    // You can find a list of imagery providers right here: https://leaflet-extras.github.io/leaflet-providers/preview/.
    searchMaps[mapId] = new L.Map(mapId, {center: INIT_MAP_CENTER, zoom: INIT_MAP_ZOOM})
        .addLayer(new L.tileLayer(MAP_LAYER_URL, {
            maxZoom: MAP_MAX_ZOOM,
            attribution: MAP_ATTRIBUTION
        }));

    // Initializes the drawn item in order to store the shapes drawn by the user
    // with the Leaflet.draw library.
    var drawnItems = new L.FeatureGroup().addTo(searchMaps[mapId]);
    // The map can have one of the two following draw controls:
    //  - drawControlFull: allows the user to draw a polygon on the map.
    //  - drawControlEditOnly: allows the user to update the drawn polygon.
    // Initializes first the draw control, by only allowing the user to draw rectangles and/or circles.
    drawControlFull[mapId] = new L.Control.Draw({
        draw: {
            polyline: false,
            polygon: false,
            circle: (hasCircle ? {
                shapeOptions: {
                    color: '#0033ff'
                }
            } : false),
            marker: false,
            rectangle: (hasRectangle ? {
                shapeOptions: {
                    color: '#0033ff'
                }
            } : false),
        },
        edit: false
    });
    // Initializes the second draw control, by only allowing the user to update the polygon.
    drawControlEditOnly[mapId] = new L.Control.Draw({
        edit: {
            featureGroup: drawnItems,
            remove: false
        },
        draw: false
    });
    // Adds the first draw control to the map so the user can draw a polygon.
    searchMaps[mapId].addControl(drawControlFull[mapId]);

    // Occurs when the user drew a new polygon.
    // Saves the coordinates, removes the first draw control and adds the second one to the map, so the user can update the drawn polygon.
    searchMaps[mapId].on('draw:created', function(e) {
        // Erases each potential other drawn polygons of the map before drawing the
        // current one.
        erasePolygons(searchMaps[mapId]);

        // Saves the rectangle's coordinates if the user can draw a rectangle.
        if (hasRectangle) {
            boundingRectangleLatLngs = [
                [e.layer._latlngs[0].lat, e.layer._latlngs[0].lng],
                [e.layer._latlngs[1].lat, e.layer._latlngs[1].lng],
                [e.layer._latlngs[2].lat, e.layer._latlngs[2].lng],
                [e.layer._latlngs[3].lat, e.layer._latlngs[3].lng],
            ];

            // Unselect the potential selected country in the countries' list.
            $('#streamingDefaultArea option[value=""]').prop('selected', true);

            // Indicates that the user manully drew a rectangle.
            rectangleManuallyDrawn = true;
        // Otherwise saves the circle's latitude, longitude and radius.
        } else {
            circleLatLngRad = {
                "latitude": e.layer._latlng.lat,
                "longitude": e.layer._latlng.lng,
                "radius": (e.layer._mRadius / 1000)
            }
        }

        drawnItems.addLayer(e.layer);
        drawControlFull[mapId].removeFrom(searchMaps[mapId]);
        drawControlEditOnly[mapId].addTo(searchMaps[mapId]);
    });

    // Occurs when the user updated a polygon.
    // Saves the polygon's coordinates.
    searchMaps[mapId].on('draw:edited', function(e) {
        if (hasRectangle) {
            boundingRectangleLatLngs = [
                [e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[0].lat, e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[0].lng],
                [e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[1].lat, e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[1].lng],
                [e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[2].lat, e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[2].lng],
                [e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[3].lat, e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[3].lng],
            ];
        } else {
            circleLatLngRad = {
                "latitude": e.layers._layers[Object.keys(e.layers._layers)[0]]._latlng.lat,
                "longitude": e.layers._layers[Object.keys(e.layers._layers)[0]]._latlng.lng,
                "radius": (e.layers._layers[Object.keys(e.layers._layers)[0]]._mRadius / 1000)
            }
        }
    });

    // Adds a Bootstrap's tooltip on the button that allows the user to draw a rectangle.
    if (hasRectangle) {
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
    // Adds a Bootstrap's tooltip on the button that allows the user to draw a circle.
    } else {
        $(".leaflet-draw-draw-circle").attr({
            "data-placement": "right",
            "data-trigger": "manual",
            title: "You can draw a circle by clicking on this button."
        });
        $(".leaflet-draw-draw-circle").tooltip("show");

        // This tooltip is removed when the user moves the cursor hover the button.
        $(".leaflet-draw-draw-circle, .tooltip").hover(function() {
            $(".leaflet-draw-draw-circle").tooltip("hide");
        })
    }
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
* Loads all elements related to the map of the search's results page.
*
* Parameters:
*   - mode: indicates the mode of the current search -> "static" or "streaming".
*/
function loadResultsMap(mode) {
    resultMaps[mode] = new L.Map(mode + "ResultsMap", {center: INIT_MAP_CENTER, zoom: INIT_MAP_ZOOM})
        .addLayer(new L.tileLayer(MAP_LAYER_URL, {
            maxZoom: MAP_MAX_ZOOM,
            attribution: MAP_ATTRIBUTION
        }));

    // Adds the cluster goup object as a layer to the map of the streaming's results,
    // in order to automatically group markers with the Leaflet.markercluster library.
    markers = L.markerClusterGroup();
    resultMaps[mode].addLayer(markers);
}

/**
* Loads all elements related to the charts of the streaming's results.
*
* Parameters:
*   - hasSecondStream: boolean value indicating if the user filled a second keywords
*                      set, in order to show/hide graphs according to the value.
*   - refresh: indicates whether the charts must automatically be refreshed (true - default)
*              or not (false).
*/
function loadStreamingResultsCharts(hasSecondStream, refresh = true) {
    // Sets global charts' parameters.
    Chart.defaults.global.title.display = true;
    Chart.defaults.global.title.fontSize = 15;

    // Initializes charts' contexes.
    var ctxTotalReceivedTweets = $("#chartTotalReceivedTweets");
    var ctxTweetsReception = $("#chartTweetsReception");
    var ctxPartsOfReceivedTweets;
    var ctxWithoutGeolocation = $("#chartWithoutGeolocation");
    var ctxWithoutGeolocationCurrent = $("#chartWithoutGeolocationCurrent");
    var ctxGeolocationComparison = $("#chartGeolocationComparison");

    // Shows graphs that can be only shown if there is more than one keywords
    // set, if so.
    if (hasSecondStream) {
        $("#chartPartsOfReceivedTweetsContainer").show();
        ctxPartsOfReceivedTweets = $("#chartPartsOfReceivedTweets");
    }

    // Contains data of a empty graph of type "line"; this object will be cloned
    // for each graph, in order to avoid shared data and bugs between graphs.
    var emptyLinedGraphData = {
        labels: [0],
        datasets: [
            {
                label: FIRST_SUBJECT_LABEL,
                fill: false,
                lineTension: 0.1,
                backgroundColor: FIRST_SUBJECT_TRANSPARENT_COLOR,
                borderColor: FIRST_SUBJECT_COLOR,
                borderCapStyle: 'butt',
                borderDash: [],
                borderDashOffset: 0.0,
                borderJoinStyle: 'miter',
                pointBorderColor: FIRST_SUBJECT_COLOR,
                pointBackgroundColor: "#fff",
                pointBorderWidth: 1,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: FIRST_SUBJECT_COLOR,
                pointHoverBorderColor: "rgba(220, 220, 220, 1)",
                pointHoverBorderWidth: 2,
                pointRadius: 1,
                pointHitRadius: 10,
                data: [0]
            }
        ]
    };
    // Adds a second dataset to the default data of lined graphs if there is more
    // than one keyword set.
    if (hasSecondStream) {
        emptyLinedGraphData.datasets.push({
            label: SECOND_SUBJECT_LABEL,
            fill: false,
            lineTension: 0.1,
            backgroundColor: SECOND_SUBJECT_TRANSPARENT_COLOR,
            borderColor: SECOND_SUBJECT_COLOR,
            borderCapStyle: 'butt',
            borderDash: [],
            borderDashOffset: 0.0,
            borderJoinStyle: 'miter',
            pointBorderColor: SECOND_SUBJECT_COLOR,
            pointBackgroundColor: "#fff",
            pointBorderWidth: 1,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: SECOND_SUBJECT_COLOR,
            pointHoverBorderColor: "rgba(220, 220, 220, 1)",
            pointHoverBorderWidth: 2,
            pointRadius: 1,
            pointHitRadius: 10,
            data: [0]
        });
    }

    // Contains data of the empty graph of type "bar", which compare Tweets with
    // geolocation vs. Tweets without; this object will be cloned for each graph
    // (there could be more than one in the future), in order to avoid shared
    // data and bugs between graphs.
    var geolocationComparisonGraphData = {
        labels: ["WITH geolocation", "WITHOUT geolocation"],
        datasets: [
            {
                label: "Percentage",
                backgroundColor: FIRST_SUBJECT_TRANSPARENT_COLOR,
                borderColor: FIRST_SUBJECT_COLOR,
                borderWidth: 1,
                hoverBackgroundColor: FIRST_SUBJECT_TRANSPARENT_COLOR,
                hoverBorderColor: FIRST_SUBJECT_COLOR,
                data: [0, 0],
            }
        ]
    };
    // Adds a second dataset to the data of the bar graphs if there is more than
    // one keyword set.
    if (hasSecondStream) {
        geolocationComparisonGraphData.labels = [
            "1st sub. WITH geolocation",
            "1st sub. WITHOUT geolocation",
            "2nd sub. WITH geolocation",
            "2nd sub. WITHOUT geolocation",
        ];
        // There is two datasets (in order to differenciate subjects by colors),
        // but each dataset share the same graph's labels, so we have to set
        // some data to null in order to avoid a display in the wrong part of
        // the graph.
        geolocationComparisonGraphData.datasets[0].data = [0, 0, null, null];
        geolocationComparisonGraphData.datasets.push({
            label: "Percentage",
            backgroundColor: SECOND_SUBJECT_TRANSPARENT_COLOR,
            borderColor: SECOND_SUBJECT_COLOR,
            borderWidth: 1,
            hoverBackgroundColor: SECOND_SUBJECT_TRANSPARENT_COLOR,
            hoverBorderColor: SECOND_SUBJECT_COLOR,
            data: [null, null, 0, 0],
        });
    }

    // Creates the lined graph that displays the total of received Tweets since the
    // beginning of the streaming process. There can only be 10 labels per axe, to
    // avoid display's bugs.
    chartTotalReceivedTweets = new Chart(ctxTotalReceivedTweets, {
        type: 'line',
        data: cloneObject(emptyLinedGraphData),
        options: {
            legend: {
                display: hasSecondStream
            },
            scales: {
                xAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Time [seconds]',
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        maxTicksLimit: 10,
                        stepSize: 1
                    }
                }],
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Nb. of received Tweets',
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        maxTicksLimit: 10
                    }
                }]
            },
            title: {
                text: "Total of received Tweets, by time"
            }
        }
    });

    // Creates the lined graph that displays the current's Tweets reception rate since
    // the beginning of the streaming process.
    chartTweetsReception = new Chart(ctxTweetsReception, {
        type: 'line',
        data: cloneObject(emptyLinedGraphData),
        options: {
            legend: {
                display: hasSecondStream
            },
            scales: {
                xAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Time [seconds]',
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        maxTicksLimit: 10,
                        stepSize: 1
                    }
                }],
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Nb. of received Tweets',
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        maxTicksLimit: 10
                    }
                }]
            },
            title: {
                text: "Reception of Tweets, by time"
            }
        }
    });

    // Creates the doughnut graph that displays the parts of each subjects for the
    // current streaming process, only if there are several subjects.
    if (hasSecondStream) {
        chartPartsOfReceivedTweets = new Chart(ctxPartsOfReceivedTweets, {
            type: 'doughnut',
            data: {
                labels: [FIRST_SUBJECT_LABEL, SECOND_SUBJECT_LABEL],
                datasets: [
                    {
                        data: [0, 0],
                        backgroundColor: [
                            FIRST_SUBJECT_COLOR,
                            SECOND_SUBJECT_COLOR
                        ],
                        hoverBackgroundColor: [
                            FIRST_SUBJECT_COLOR,
                            SECOND_SUBJECT_COLOR
                        ]
                    }
                ]
            },
            options: {
                title: {
                    text: "Parts of the received Tweets by subject"
                }
            }
        });
    }

    // Creates the lined graph that displays the total of received Tweets (with and
    // WITHOUT geolocation) since the beginning of the streaming process. There can
    // only be 10 labels per axe, to avoid display's bugs.
    chartWithoutGeolocation = new Chart(ctxWithoutGeolocation, {
        type: 'line',
        data: cloneObject(emptyLinedGraphData),
        options: {
            legend: {
                display: hasSecondStream
            },
            scales: {
                xAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Time [seconds]',
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        maxTicksLimit: 10,
                        stepSize: 1
                    }
                }],
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Nb. of received Tweets',
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        maxTicksLimit: 10
                    }
                }]
            },
            title: {
                text: "Total of received Tweets, by time"
            }
        }
    });

    // Creates the lined graph that displays the current's Tweets reception rate since
    // the beginning of the streaming process.
    chartWithoutGeolocationCurrent = new Chart(ctxWithoutGeolocationCurrent, {
        type: 'line',
        data: cloneObject(emptyLinedGraphData),
        options: {
            legend: {
                display: hasSecondStream
            },
            scales: {
                xAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Time [seconds]',
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        maxTicksLimit: 10,
                        stepSize: 1
                    }
                }],
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Nb. of received Tweets',
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        maxTicksLimit: 10
                    }
                }]
            },
            title: {
                text: "Reception of Tweets, by time"
            }
        }
    });

    // Creates the bar graph that displays the parts of Tweets with and without
    // geolocation, for each subject.
    chartGeolocationComparison = new Chart(ctxGeolocationComparison, {
        type: 'bar',
        data: geolocationComparisonGraphData,
        options: {
            legend: {
                display: false
            },
            scales: {
                xAxes: [{
                    stacked: true
                }],
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: "Percentage of Tweets",
                        fontStyle: "bold"
                    },
                    ticks: {
                        beginAtZero: true,
                        max: 100,
                        maxTicksLimit: 10,
                        min: 0
                    }
                }]
            },
            title: {
                text: "Tweets with geolocation vs. Tweets without"
            }
        }
    });

    // Refreshs the graphs if they have to.
    if (refresh) {
        var index = 0;
        // Will contain the last number of received Tweet for each interval's tick, in
        // order to do calculations.
        // The total attributes will contain the last number of received Tweets that
        // have or not geolocation tags.
        var lastNbReceivedTweets = {
            "first": 0,
            "second": 0,
            "firstTotal": 0,
            "secondTotal": 0
        };
        // Indicates if the lined graphs still display results by seconds or not.
        // These graphs indeed display results by seconds until 60 seconds, from where
        // they will display them by minutes.
        var stillSeconds = true;

        /**
        * Refresh the lined charts.
        * This function is executed at each tick of the lined charts' interval.
        */
        function lineChartsInterval() {
            index += 1;

            // When 60 seconds elapsed since the beginning of the streaming process, the lined
            // graph will display their results by minutes and not by seconds anymore.
            if (stillSeconds && index >= 60) {
                stillSeconds = false;
                index = 1;

                // Change the graphs' time system by erasing all the x-axes' labels and by
                // displaying the last result (the ones from the 60th second) in the first minutes.
                chartTotalReceivedTweets.options.scales.xAxes[0].scaleLabel.labelString =
                    chartTweetsReception.options.scales.xAxes[0].scaleLabel.labelString =
                    chartWithoutGeolocation.options.scales.xAxes[0].scaleLabel.labelString =
                    chartWithoutGeolocationCurrent.options.scales.xAxes[0].scaleLabel.labelString =
                    "Time [minutes]";
                chartTotalReceivedTweets.data.labels = [0, index];
                chartTotalReceivedTweets.data.datasets[0].data = [0, nbReceivedTweets.first];
                if (hasSecondStream) {
                    chartTotalReceivedTweets.data.datasets[1].data = [0, nbReceivedTweets.second];
                }

                chartTweetsReception.data.labels = [0, index];
                chartTweetsReception.data.datasets[0].data = [0, nbReceivedTweets.first];
                if (hasSecondStream) {
                    chartTweetsReception.data.datasets[1].data = [0, nbReceivedTweets.second];
                }

                chartWithoutGeolocation.data.labels = [0, index];
                chartWithoutGeolocation.data.datasets[0].data = [0, nbReceivedTweets.firstTotal];
                if (hasSecondStream) {
                    chartWithoutGeolocation.data.datasets[1].data = [0, nbReceivedTweets.secondTotal];
                }

                chartWithoutGeolocationCurrent.data.labels = [0, index];
                chartWithoutGeolocationCurrent.data.datasets[0].data = [0, nbReceivedTweets.firstTotal];
                if (hasSecondStream) {
                    chartWithoutGeolocationCurrent.data.datasets[1].data = [0, nbReceivedTweets.secondTotal];
                }

                // Clears the current interval and change its refreshment rate to 60 seconds.
                clearInterval(lineChartsUpdateInterval);
                lineChartsUpdateInterval = setInterval(lineChartsInterval, 60 * 1000);
            } else {
                // Inserts new data in the graphs.
                chartTotalReceivedTweets.data.labels.push(index);
                chartTotalReceivedTweets.data.datasets[0].data.push(nbReceivedTweets.first);
                if (hasSecondStream) {
                    chartTotalReceivedTweets.data.datasets[1].data.push(nbReceivedTweets.second);
                }

                chartTweetsReception.data.labels.push(index);
                chartTweetsReception.data.datasets[0].data.push(nbReceivedTweets.first - lastNbReceivedTweets.first);
                if (hasSecondStream) {
                    chartTweetsReception.data.datasets[1].data.push(nbReceivedTweets.second - lastNbReceivedTweets.second);
                }

                chartWithoutGeolocation.data.labels.push(index);
                chartWithoutGeolocation.data.datasets[0].data.push(nbReceivedTweets.firstTotal);
                if (hasSecondStream) {
                    chartWithoutGeolocation.data.datasets[1].data.push(nbReceivedTweets.secondTotal);
                }

                chartWithoutGeolocationCurrent.data.labels.push(index);
                chartWithoutGeolocationCurrent.data.datasets[0].data.push(nbReceivedTweets.firstTotal - lastNbReceivedTweets.firstTotal);
                if (hasSecondStream) {
                    chartWithoutGeolocationCurrent.data.datasets[1].data.push(nbReceivedTweets.secondTotal - lastNbReceivedTweets.secondTotal);
                }
            }

            // Saves the current number of received tweets.
            lastNbReceivedTweets.first = nbReceivedTweets.first;
            lastNbReceivedTweets.second = nbReceivedTweets.second;
            lastNbReceivedTweets.firstTotal = nbReceivedTweets.firstTotal;
            lastNbReceivedTweets.secondTotal = nbReceivedTweets.secondTotal;

            // Updates the graphs to animate them with the new data.
            chartTotalReceivedTweets.update();
            chartTweetsReception.update();
            chartWithoutGeolocation.update();
            chartWithoutGeolocationCurrent.update();
        }

        // Starts the lined charts' refreshment process, which ticks every second until 60 seconds,
        // and then every minute.
        lineChartsUpdateInterval = setInterval(lineChartsInterval, 1000);

        // Starts the doughnut/bar charts' refreshment process, which ticks every second.
        doughnutBarChartsUpdateInterval = setInterval(function() {
            // Refreshs the chart displaying the parts of received Tweets for each subject,
            // only if the user filled several keywords sets.
            // Refreshs each dataset of the bar chart, depending on the number of subjects.
            if (hasSecondStream) {
                chartPartsOfReceivedTweets.data.datasets[0].data = [nbReceivedTweets.first, nbReceivedTweets.second];
                chartPartsOfReceivedTweets.update();

                chartGeolocationComparison.data.datasets[0].data = [
                    Math.round(nbReceivedTweets.first / (nbReceivedTweets.firstTotal / 100) * 100) / 100,
                    Math.round((nbReceivedTweets.firstTotal - nbReceivedTweets.first) / (nbReceivedTweets.firstTotal / 100) * 100) / 100,
                    null,
                    null
                ];
                chartGeolocationComparison.data.datasets[1].data = [
                    null,
                    null,
                    Math.round(nbReceivedTweets.second / (nbReceivedTweets.secondTotal / 100) * 100) / 100,
                    Math.round((nbReceivedTweets.secondTotal - nbReceivedTweets.second) / (nbReceivedTweets.secondTotal / 100) * 100) / 100
                ];
            } else {
                chartGeolocationComparison.data.datasets[0].data = [
                    Math.round(nbReceivedTweets.first / (nbReceivedTweets.firstTotal / 100) * 100) / 100,
                    Math.round((nbReceivedTweets.firstTotal - nbReceivedTweets.first) / (nbReceivedTweets.firstTotal / 100) * 100) / 100
                ];
            }

            chartGeolocationComparison.update();
        }, 1000);
    }
}

/**
* Calculates and displays the speed of the given received Tweets in the given time (in seconds),
* then calculates and apply the color levels associated to it.
* The calculations are operated according to the current number of received Tweets and the current elapsed time.
*/
function calculateAndDisplaySpeedValues() {
    // Displays the average speeds and change their colors by their values (red => bad speed; green => good speed).
    $.each(nbReceivedTweets, function(key, value) {
        // We don't want to calculate the speed of the total number of all received Tweets (with or without geolocation).
        if (key.indexOf("Total") == -1) {
            // Gets the speed value of received Tweets per minutes, with at most two decimals.
            var speedPerMinutes = Math.round(60 * (value / elapsedTime) * 100) / 100;
            // We wants to switch the hue color between 0 (red - bad speed) and 120 (green - good speed), according to the average speed.
            var hueColorLevel =
                (speedPerMinutes * (GOOD_SPEED_HUE_COLOR / GOOD_SPEED) > GOOD_SPEED_HUE_COLOR) ?
                    GOOD_SPEED_HUE_COLOR : speedPerMinutes * (GOOD_SPEED_HUE_COLOR / GOOD_SPEED);
            // We want to switch the lightness color level from 50% (bad speed) to 25% (good speed).
            var lightnessColorLevel =
                (BAD_SPEED_LIGHTNESS_COLOR - speedPerMinutes / (GOOD_SPEED / GOOD_SPEED_LIGHTNESS_COLOR) < GOOD_SPEED_LIGHTNESS_COLOR) ?
                    GOOD_SPEED_LIGHTNESS_COLOR : BAD_SPEED_LIGHTNESS_COLOR - speedPerMinutes / (GOOD_SPEED / GOOD_SPEED_LIGHTNESS_COLOR);

            // Displays the speed value with at most two decimal, only for the displayed elements.
            $("#" + key + "StreamingSpeed:visible").text(speedPerMinutes + " Tweet(s) / minute");
            $("#" + key + "StreamingSpeed:visible").css("color", "hsl(" + hueColorLevel + ", 100%, " + lightnessColorLevel + "%)");
        }
    })
}

/**
* Loads all elements related to the components, map and charts of the streaming's results.
*/
function loadStreamingResultsComponents() {
    // Displays and initializes GUI elements on the results page.
    getAndFormatKeywords("first", STREAMING_MODE_IDENTIFIER);
    var secondKeywords = getAndFormatKeywords("second", STREAMING_MODE_IDENTIFIER);

    // Loads the map and charts components.
    loadResultsMap(STREAMING_MODE_IDENTIFIER);
    loadStreamingResultsCharts(secondKeywords.length != 0);

    $("#firstStreamingSubject").html(humanQueryString["first"]);
    $("#streamingLanguage").text($("#dynamicLanguage option:selected").val() == "" ? "ANY" : $("#dynamicLanguage option:selected").val());

    if (secondKeywords) {
        $("#firstStreamingSubjectText").html("<u>First</u> streaming's subject: ");
        $("#firstStreamingNumberText").html("Number of received Tweets for the <u>first</u> streaming: ");
        $("#firstStreamingSpeedText").html("<u>First</u> streaming's average speed: ");
        $("#secondStreamingSubject").html(humanQueryString["second"]);
        $(".second-results-element").show();
    }

    // Draws the manually drawn rectangle on the map of the streaming's results if the user
    // manually drew the rectangle.
    if (rectangleManuallyDrawn) {
        drawPolygons(resultMaps[STREAMING_MODE_IDENTIFIER], [boundingRectangleLatLngs]);
    // Otherwise draws each selected country's territories on the map of the streaming's results.
    } else {
        drawPolygons(resultMaps[STREAMING_MODE_IDENTIFIER], selectedCountryCoordinates);
    }

    // Displays the receptions' speeds and sends the current results to the server, each second.
    speedInterval = setInterval(function() {
        var HhMmSsElapsedTime = secondsToHhMmSs(++elapsedTime);
        // Increments and display the elapsed time as a HH:MM:SS format.
        $("#elapsedTime").text(HhMmSsElapsedTime);

        // Displays the average speeds and change their colors by their values (red => bad speed; green => good speed).
        calculateAndDisplaySpeedValues();

        // Sends the current results to the server.
        if (socketConnection) {
            // Contains the last chart's current data if they are set, or 0 else.
            var cgc = [
                chartGeolocationComparison.data.datasets[0].data[0] ? chartGeolocationComparison.data.datasets[0].data[0] : 0,
                chartGeolocationComparison.data.datasets[0].data[1] ? chartGeolocationComparison.data.datasets[0].data[1] : 0
            ]
            if (secondKeywords) {
                cgc.push(chartGeolocationComparison.data.datasets[1].data[2] ? chartGeolocationComparison.data.datasets[1].data[2] : 0);
                cgc.push(chartGeolocationComparison.data.datasets[1].data[3] ? chartGeolocationComparison.data.datasets[1].data[3] : 0);
            }

            socketConnection.send(JSON.stringify({
                "messageType": "currentResults",
                "elapsedTime": HhMmSsElapsedTime,
                "gtrt": JSON.stringify([chartTotalReceivedTweets.data.datasets[0].data, (secondKeywords ? chartTotalReceivedTweets.data.datasets[1].data : [])]),
                "grt": JSON.stringify([chartTweetsReception.data.datasets[0].data, (secondKeywords ? chartTweetsReception.data.datasets[1].data : [])]),
                "gprt": JSON.stringify(secondKeywords ? chartPartsOfReceivedTweets.data.datasets[0].data : []),
                "atrt": JSON.stringify([chartWithoutGeolocation.data.datasets[0].data, (secondKeywords ? chartWithoutGeolocation.data.datasets[1].data : [])]),
                "art": JSON.stringify([chartWithoutGeolocationCurrent.data.datasets[0].data, (secondKeywords ? chartWithoutGeolocationCurrent.data.datasets[1].data : [])]),
                "agvw": JSON.stringify([cgc.slice(0, 2), (secondKeywords ? cgc.slice(2, 4) : [])])
            }));
        }
    }, 1000)

    $("#numberTweetsMax").text(MAX_DISPLAYED_TWEETS);
}

function loadFileResultsComponents(data) {
    // Indicates if there is a second subject set in the file.
    var hasSecondSubject = data.secondSubject && data.secondSubject.length != 0;

    // Loads the components, which are stopped (no actove timer).
    $("#btnStopStreaming").hide();
    $("#btnNewSearch").show();
    $("#streamingResultsTitle").html("Here are the exported file's results!");
    $("#noTweetReceivedText").text("Sorry, there is no Tweet.");
    $("#numberTweetsMax").text(MAX_DISPLAYED_TWEETS);
    $("#elapsedTime").text(data.results.elapsedTime);
    $("#streamingLanguage").text(data.language);
    $("#firstStreamingSubject").text(data.firstSubject);
    if (hasSecondSubject) {
        $("#firstStreamingSubjectText").html("<u>First</u> streaming's subject: ");
        $("#firstStreamingNumberText").html("Number of received Tweets for the <u>first</u> streaming: ");
        $("#firstStreamingSpeedText").html("<u>First</u> streaming's average speed: ");
        $("#secondStreamingSubject").text(data.secondSubject);
        $(".second-results-element").show();
    }

    // Loads the map and charts components (without automatic refreshment).
    loadResultsMap(STREAMING_MODE_IDENTIFIER);
    loadStreamingResultsCharts(hasSecondSubject, false);

    // Draws the location rectangle on the map.
    invertCoordinates(data.coordinates);
    drawPolygons(resultMaps[STREAMING_MODE_IDENTIFIER], [data.coordinates], true);

    // Displays each Tweet and count the number of Tweets per subject.
    $.each(data.tweets, function(key, tweet) {
        // Increments the number of received Tweets for the current Tweet's subject, in order to calculate the speed values.
        ++nbReceivedTweets[tweet.subjectIdentifier];

        // Shows the reveived tweets panel if not already done.
        if ($("#noTweetReceivedText").is(":visible")) {
            $("#noTweetReceivedText").hide();
            $("#maxNumberDisplayedTweets").fadeIn();
            $("#streamingTweetsContent").fadeIn();
        }

        // Adds the new Tweet on the map and displays it in the results panel.
        // The Leaflet.markercluster library will automatically group Tweets on the map.
        addTweetOnPage(STREAMING_MODE_IDENTIFIER, tweet.subjectIdentifier, tweet.latitude, tweet.longitude, tweet.dateAndTime, tweet.user, tweet.content);

        // Removes the old received Tweets it there is too many of theme (in order to avoid
        // the web browser to lag).
        if ($("#streamingTweetsContent div").length > MAX_DISPLAYED_TWEETS) {
            $("#streamingTweetsContent div").last().remove();
        }
    })

    // Gets the elapsed time in seconds.
    elapsedTime = moment.duration(data.results.elapsedTime, "HH:mm:ss").asSeconds();
    // Displays the average speeds and change their colors by their values (red => bad speed; green => good speed).
    calculateAndDisplaySpeedValues();

    // Loads the charts.
    // Contains all the lined charts and their associated abbreviation key.
    var linedCharts = {
        "gtrt": chartTotalReceivedTweets,
        "grt": chartTweetsReception,
        "atrt": chartWithoutGeolocation,
        "art": chartWithoutGeolocationCurrent
    };
    var labels = [0];
    // Indicates the number of labels, depending on the elapsed time (one label per second if there was less than one minute, otherwise one label per minute).
    var numberOfLabels = (elapsedTime > 59 ? moment.duration(data.results.elapsedTime, "HH:mm:ss").asMinutes() : elapsedTime);
    // Calculates the lines charts' labels.
    for (var i = 1; i <= numberOfLabels; ++i) {
        labels.push(i);
    }

    // Loads each lined graph's data.
    $.each(linedCharts, function(id, chart) {
        if (elapsedTime > 59) {
            chart.options.scales.xAxes[0].scaleLabel.labelString = "Time [minutes]";
        }

        // Sets the labels.
        chart.data.labels = labels;
        // Sets the first subject's data.
        chart.data.datasets[0].data = data.results[id][0];

        // Sets the second subject's data, only if there is a second subject.
        if (hasSecondSubject) {
            chart.data.datasets[1].data = data.results[id][1];
        }
    })

    // Loads the chart displaying the parts of received Tweets for each subject,
    // only if there is several subjects.
    // Also refreshs each dataset of the bar chart, depending on the number of subjects.
    if (hasSecondSubject) {
        chartPartsOfReceivedTweets.data.datasets[0].data = data.results.gprt;

        chartGeolocationComparison.data.datasets[0].data = [
            data.results.agvw[0][0],
            data.results.agvw[0][1],
            null,
            null
        ];
        chartGeolocationComparison.data.datasets[1].data = [
            null,
            null,
            data.results.agvw[1][0],
            data.results.agvw[1][1]
        ];
    } else {
        chartGeolocationComparison.data.datasets[0].data = [
            data.results.agvw[0][0],
            data.results.agvw[0][1]
        ];
    }
}

/**
* Loads all elements related to the components and map of the static mode's results.
*/
function loadStaticResultsComponents() {
    // Displays and initializes GUI elements on the results page.
    var firstKeywords = getAndFormatKeywords("first", STATIC_MODE_IDENTIFIER);
    var secondKeywords = getAndFormatKeywords("second", STATIC_MODE_IDENTIFIER);

    // Loads the map component.
    loadResultsMap(STATIC_MODE_IDENTIFIER);

    $("#firstStaticSubject").html(humanQueryString["first"]);
    $("#staticSelectedLanguage").text($("#staticLanguage option:selected").val() == "" ? "ANY" : $("#staticLanguage option:selected").val());


    if (secondKeywords) {
        $("#firstStaticSubjectText").html("<u>First</u> subject: ");
        $("#firstStaticNumberText").html("Number of Tweets for the <u>first</u> subject: ");
        $("#secondStaticSubject").html(humanQueryString["second"]);
        $(".second-results-element").show();
    }

    // Adds a tooltip on the static mode's subject when the user moves the mouse hover it
    // and if it is too big to fill the entire cell.
    $("#firstStaticSubject, #secondStaticSubject").mouseenter(function() {
        if (this.offsetWidth < this.scrollWidth) {
            $(this).attr("data-original-title", $(this).html());
            $(this).tooltip("show");
        }
    })

    // Removes the tooltip when the user moves the mouse out of the static mode's subject.
    $("#firstStaticSubject, #secondStaticSubject").mouseleave(function() {
        $(this).tooltip("hide");
    })

    // Draws the manually drawn circle on the map of the static mode's results.
    var circle = L.circle([circleLatLngRad.latitude, circleLatLngRad.longitude], circleLatLngRad.radius * 1000, {
        color: '#0033ff',
        fillColor: '#0033ff',
        fillOpacity: 0.2
    }).addTo(resultMaps[STATIC_MODE_IDENTIFIER]);
    resultMaps[STATIC_MODE_IDENTIFIER].fitBounds(circle.getBounds());
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
    if (map === searchMaps.dynamicMap && rectangleManuallyDrawn) {
        drawControlEditOnly.dynamicMap.removeFrom(searchMaps.dynamicMap);
        drawControlFull.dynamicMap.addTo(searchMaps.dynamicMap);
    }
    // Erases each potential other drawn polygons on the map before drawing the
    // selected country's borders.
    erasePolygons(map);

    // Deals world's borders data to display a polygon on the selected country.
    // First converts the shapefile file is GeoJSON and gets the data.
    shp(jsRoutes.controllers.Assets.versioned('data/geodata/TM_WORLD_BORDERS-0.3').url).then(function(geojson) {
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
                        // opened; loads the result components and asks the server
                        // to begin the stream.
                        case "successfulInit":
                            $("#searchContent").hide();
                            $("#streamingResults").fadeIn();
                            loadStreamingResultsComponents();

                            // Since the Leaflet library uses the "latitude,longitude" format for coordinates while the
                            // Twitter's APIs use the "longitude,latitude" format, we have to invert coordinates of the
                            // bounding rectangle before sending it.
                            invertCoordinates(boundingRectangleLatLngs);

                            console.log("Streaming process successfully initialized! Asking the server to begin to stream...");
                            socketConnection.send(JSON.stringify({
                                "messageType": "readyToStream",
                                "isAreaRectangle": rectangleManuallyDrawn,
                                "firstKeywords": getAndFormatKeywords("first", STREAMING_MODE_IDENTIFIER),
                                "secondKeywords": getAndFormatKeywords("second", STREAMING_MODE_IDENTIFIER),
                                "coordinates": boundingRectangleLatLngs,
                                "language": $("#dynamicLanguage option:selected").val()
                            }));
                            break;
                        // Occurs when new Tweet's data are coming from the server.
                        case "newTweet":
                            // Updates the total number of received Tweets (with and without geolocation tags).
                            nbReceivedTweets[data.keywordsSet + "Total"] = data.nbReceivedTweets;

                            // Adds the new Tweet on the map if the user manually selected the rectangle on the map or if the
                            // Tweet belongs to the selected country's territory (since it wasn't possible to send the entire
                            // massive coordinates array through the network).
                            if (rectangleManuallyDrawn || isPointInSelectedArea(data.latitude, data.longitude, selectedCountryCoordinates)) {
                                // Sends a confirmation to the server that the Tweet belongs to the country's territories if so and if
                                // the user selected a country in the drop-down menu.
                                if (!rectangleManuallyDrawn) {
                                    socketConnection.send(JSON.stringify({
                                        "messageType": "tweetLocationConfirmation",
                                        "keywordsSet": data.keywordsSet,
                                        "internalId": data.internalId,
                                        "creationDate": data.creationDate,
                                        "longitude": data.longitude,
                                        "latitude": data.latitude,
                                        "user": data.user,
                                        "content": data.content
                                    }));
                                }

                                // Increments the number of received Tweets for the given dataset, in order to calculate the speed value.
                                ++nbReceivedTweets[data.keywordsSet];

                                // Shows the reveived tweets panel if not already done.
                                if ($("#noTweetReceivedText").is(":visible")) {
                                    $("#noTweetReceivedText").hide();
                                    $("#maxNumberDisplayedTweets").fadeIn();
                                    $("#streamingTweetsContent").fadeIn();
                                }

                                // Adds the new Tweet on the map and displays it in the results panel.
                                // The Leaflet.markercluster library will automatically group Tweets on the map.
                                addTweetOnPage(STREAMING_MODE_IDENTIFIER, data.keywordsSet, data.latitude, data.longitude, moment().format("HH:mm:ss"), data.user, data.content);

                                // Removes the old received Tweets it there is too many of theme (in order to avoid
                                // the web browser to lag).
                                if ($("#streamingTweetsContent div").length > MAX_DISPLAYED_TWEETS) {
                                    $("#streamingTweetsContent div").last().remove();
                                }
                            }

                            break;
                        // Occurs when an error occured when the server tried to create the backup file.
                        case "errorFile":
                            alert("I could not create the backup file for reasons. Try to start a new streaming process in order to resolve the problem, otherwise you won't be able to export this file at the end of the current streaming process.");
                            break;
                        // Occurs when the server stopped the streaming process for reasons.
                        case "stopStreaming":
                            // Displays an alert, depending on the reason, if set.
                            if (data.reason) {
                                switch (data.reason) {
                                    // Occurs if the user's session expired during the streaming process.
                                    case "sessionExpired":
                                        alert("Your session expired, you are going to be disconnected.");
                                        window.location.replace(jsRoutes.controllers.HomeController.logout().url);
                                        break;
                                    case "tooManyStreamingProcesses":
                                        alert("You ran too many copies of the same application authenticating with the same account name, please stop the already-running streaming instances.");
                                        break;
                                    case "queryTooLong":
                                        alert("One of the keywords set(s) you filled is too long (> 60 characters), please retry.");
                                        // Reloads the page in order to start a new search.
                                        location.reload();
                                        break;
                                    // Occurs in case of unknown exception.
                                    case "exception":
                                    default:
                                        alert("An exception occured, please retry in a while.");
                                        break;
                                }
                            }

                            // Stops the streaming process without indicating it to the server (since it is the one which
                            // ask us to stop the process).
                            stopStreaming(false, !data.reason || data.reason != "sessionExpired");

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
*   - displayExportPopup: indicates whether we want to display the exportation pop-up (true - default) or not (false).
*/
function stopStreaming(sendSocket, displayExportPopup = true) {
    if (socketConnection && sendSocket) {
        socketConnection.send(JSON.stringify({
            "messageType": "stopStreaming"
        }));
    }

    // Stops the speed's calculation and the graphs refreshment processes.
    clearInterval(speedInterval);
    clearInterval(lineChartsUpdateInterval);
    if (doughnutBarChartsUpdateInterval) {
        clearInterval(doughnutBarChartsUpdateInterval);
    }
    $("#btnStopStreaming").hide();
    $("#btnNewSearch").show();
    $("#streamingResultsTitle").html("This streaming was <strong><u>stopped</u></strong>!");

    // Asks the user if he wants to export the results.
    if (displayExportPopup && confirm("Do you want to export the results as a text file?\nIf you cancel or close this window, you will NOT be able to export them later.")) {
        // If so, uses the johnculviner's "jquery.fileDownload" library (https://github.com/johnculviner/jquery.fileDownload)
        // in order to download the text file.
        $.fileDownload(jsRoutes.controllers.SearchController.fileAction(
            "download",
            getAndFormatKeywords("first", STREAMING_MODE_IDENTIFIER),
            getAndFormatKeywords("second", STREAMING_MODE_IDENTIFIER)
        ).url)
            .done(function () {
                // Deletes the file from the server once it has been downloaded.
                deleteFile();
            })
            .fail(function () {
                var urlParts = window.location.href.split("/");

                alert(
                    "An error occurred when trying to download the file; you can try to manually download it here: \"" +
                    urlParts[0] + "//" + urlParts[2] +
                    jsRoutes.controllers.SearchController.fileAction(
                        "download",
                        getAndFormatKeywords("first", STREAMING_MODE_IDENTIFIER),
                        getAndFormatKeywords("second", STREAMING_MODE_IDENTIFIER)
                    ).url + "\"."
                );
            });
    // Otherwise just deletes the file from the server.
    } else {
        deleteFile();
    }
}

/**
* Sends an Ajax request in order to ask the server to delete the current user's
* file.
*/
function deleteFile() {
    $.ajax({
        method: "GET",
        url: jsRoutes.controllers.SearchController.fileAction("delete").url
    });
}

/*
* Adds in the results map and in the Tweets panel the Tweet whose information are given in parameters.
*
* Parameters:
*   - mode: indicates the current mode of the search -> "static" or "streaming".
*   - subjectNumber: indicates the subject's identifier in which the Tweet belongs to -> "first" or "second".
*   - latitude: the latitude coordinate of the Tweet to add, or 0 if the Tweet doesn't have a geolocation.
*   - longitude: the longitude coordinate of the Tweet to add, or 0 if the Tweet doesn't have a geolocation.
*   - date: the date as a string of the Tweet.
*   - user: the name of the user who wrote the Tweet.
*   - content: the Tweet's content.
*/
function addTweetOnPage(mode, subjectNumber, latitude, longitude, date, user, content) {
    if (latitude != 0 && longitude != 0) {
        markers.addLayer(L.marker([latitude, longitude], {icon: markersIcons[subjectNumber]}));
        // Updates the geolocated Tweets' counter.
        var elementNumberName = "#" + subjectNumber + mode.charAt(0).toUpperCase() + mode.slice(1) + "Number";
        $(elementNumberName).text(parseInt($(elementNumberName).text()) + 1);
    }

    $("#" + mode + "TweetsContent").prepend(
        "<div class='" + subjectNumber + "-subject-text'>\
            <strong>[" + date + "] " + user + "</strong>: " + content + "<br/>\
        </div>"
    );
}

/**
* Sends a Ajax request to the server in order to get Tweets from the Twitter's REST API,
* according to the validates user's input.
*/
function getStaticTweets() {
    $("#viewStaticResultsBtn").html("<span class='fa fa-spinner fa-spin loading-icon'></span>Searching...");
    $("#viewStaticResultsBtn").prop("disabled", true);

    // Makes an Ajax request to the server in order to get the Tweets.
    $.ajax({
        method: "GET",
        url: jsRoutes.controllers.SearchController.staticResults().url,
        data: {
            "firstKeywords": getAndFormatKeywords("first", STATIC_MODE_IDENTIFIER),
            "secondKeywords": getAndFormatKeywords("second", STATIC_MODE_IDENTIFIER),
            "fromDate": $("#staticFromDate").val(),
            "toDate": $("#staticToDate").val(),
            "locationLat": circleLatLngRad.latitude,
            "locationLon": circleLatLngRad.longitude,
            "locationRad": circleLatLngRad.radius,
            "language": $("#staticLanguage option:selected").val()
        }
    })
    .done(function(msg) {
        // Checks if the server sent an error.
        if (msg.error) {
            switch (msg.error) {
                // Disconnects the user if he is no longer connected.
                case "sessionExpired":
                    alert("Your session expired, you are going to be disconnected.");
                    window.location.replace(jsRoutes.controllers.HomeController.logout().url);
                    break;
                case "fieldsFormat":
                    alert("At least one of the given fields is not properly formatted, please retry.");
                    break;
                case "fieldEmptyOrNotValid":
                    alert("Please fill all mandatory fields in a valid way.");
                    break;
                default:
                    alert("An unexpected error occured, please retry in a while.");
                    break;
            }
        // Otherwise checks that the received Tweets object is properly formatted.
        } else if (msg.first.tweets && msg.first.tweets.length > 0 && (!msg.second || msg.second.tweets)) {
            var tweets = [];

            // Displays the results page.
            $("#searchContent").hide();
            $("#staticResults").fadeIn();
            loadStaticResultsComponents();

            // Collects and counts Tweets of each subject.
            for (label in msg) {
                $("#" + label + "StaticTotalNumber").text(msg[label].tweets.length);
                tweets = tweets.concat(msg[label].tweets);
            }

            // Then alphabetically sorts the tweets by their date and time.
            tweets.sort(function(a, b) {
                var dateA = new Date(a.date.replace(", ", "T")).getTime();
                var dateB = new Date(b.date.replace(", ", "T")).getTime();

                if (dateA < dateB) return -1;
                else if (dateA > dateB) return 1;
                else return 0;
            });

            // Iterates over each subject's Tweet in order to display it.
            tweets.forEach(function(tweet) {
                // Adds the current Tweet on the map and displays it in the results panel.
                // The Leaflet.markercluster library will automatically group Tweets on the map.
                addTweetOnPage(STATIC_MODE_IDENTIFIER, tweet.subjectNumber, tweet.latitude, tweet.longitude, tweet.date, tweet.user, tweet.content);
            })
        } else {
            alert("Sorry, there is no result for the given parameters.");
        }

        $("#viewStaticResultsBtn").html("View Results!");
        $("#viewStaticResultsBtn").prop("disabled", false);
    })
    .fail(function(jqXHR, textStatus) {
        alert("An unexpected error occured, please retry in a while.");
        $("#viewStaticResultsBtn").html("View Results!");
        $("#viewStaticResultsBtn").prop("disabled", false);
    });
}

/**
* Validates the streaming form's fields.
* Returns either 'true' if everything is valid or 'false' otherwise.
*/
function validateDynamicFields() {
    var status = SUCCESS_STATUS;

    // There must be at least one keyword.
    if (!$("#streamingFirstKeywordSetOr").val() && !$("#streamingFirstKeywordSetAnd").val()) {
        status = FIRST_KEYWORD_NOT_SET;
    // The user must have selected an area on the map.
    } else if (boundingRectangleLatLngs.length == 0) {
        status = LOCATION_NOT_SELECTED;
    }

    return status;
}

/**
* Validates the static mode form's fields.
* Returns either 'true' if everything is valid or 'false' otherwise.
*/
function validateStaticFields() {
    var status = SUCCESS_STATUS;
    var fromDate = $("#staticFromDate").val();
    var toDate = $("#staticToDate").val();

    // There must be at least one keyword.
    if (!$("#staticFirstKeywordSetOr").val() && !$("#staticFirstKeywordSetAnd").val()) {
        status = FIRST_KEYWORD_NOT_SET;
    // The user must have filled the date fields.
    } else if (!fromDate || !toDate) {
        status = DATE_NOT_SET;
    // The entered dates must match the date format.
    } else if (!moment(fromDate, DATE_FORMAT, true).isValid() || !moment(toDate, DATE_FORMAT, true).isValid()) {
        status = DATE_NOT_VALID;
    // The to date must be greater than the from date.
    } else if (moment(fromDate, DATE_FORMAT).toDate() >= moment(toDate, DATE_FORMAT).toDate()) {
        status = FROM_DATE_GREATER_THAN_TO_DATE;
    // The user must have selected an area on the map.
    } else if (circleLatLngRad == null) {
        status = LOCATION_NOT_SELECTED;
    }

    return status;
}

/**
* Gets the string representing the track (query) parameter of the Twitter's streaming or static request,
* according to the values of the user's AND and OR inputs.
* In the Twitter's API, AND parameters take priority over OR parameters (for example
* "dog AND eating OR dog AND drinking" will be interpreted as "(dog AND eating) OR (dog AND drinking)").
* In the query, a space (" ") is interpreted as a AND, and a either a comma ("," - for the streaming) or
* a "OR" keyword (for the static mode) will be interpreted as a OR. Parentheses are not supported.
* Here are some example of output, according to the input fields:
*   AND KEYWORDS            OR KEYWORDS             STREAMING RESULT                                STATIC RESULT
*   - AND: ""               OR: ""                  => ""                                           [SAME]
*   - AND: "job engineer"   OR: ""                  => "job engineer"                               [SAME]
*   - AND: ""               OR: "job engineer"      => "job,engineer"                               "job OR engineer"
*   - AND: "job"            OR: "engineer nursing"  => "job engineer,job nursing"                   "job engineer OR job nursing"
*   - AND: "job anybody"    OR: "engineer"          => "job anybody engineer"                       [SAME]
*   - AND: "job anybody"    OR: "engineer nursing"  => "job anybody engineer, job anybody nursing"  "job anybody engineer OR job anybody nursing"
*   - AND: "job"            OR: "engineer"          => "job engineer"                               [SAME]
*
* Parameters:
*   - keywordsSetNumber: indicates the keyword set we are working on => "first" for the first
*                        one, "second" for the second one.
*   - mode: indicates the mode in which the user is; either "streaming" or "static".
*/
function getAndFormatKeywords(keywordsSetNumber, mode) {
    var orField, andField;
    var resultString = "";

    // Gets the right fields, according to the given parameter.
    switch (keywordsSetNumber) {
        case "first":
            orField = $("#" + mode + "FirstKeywordSetOr").val();
            andField = $("#" + mode + "FirstKeywordSetAnd").val();
            break;
        case "second":
            orField = $("#" + mode + "SecondKeywordSetOr").val();
            andField = $("#" + mode + "SecondKeywordSetAnd").val();
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
            if (i < len - 1) resultString += (mode === STREAMING_MODE_IDENTIFIER ? "," : " OR ");
        }

        // Updates the human-understandable query's string.
        humanQueryString[keywordsSetNumber] = andField.split(" ").join(" <u>AND</u> ") + " <u>AND</u> (" + orWords.join(" <u>OR</u> ") + ")";
    // 2. Only the OR field is set => returns a comma-separated string.
    } else if (orField) {
        // Adds each comma-separated OR word to the query, depending on the mode.
        if (mode === STREAMING_MODE_IDENTIFIER) {
            resultString = orField.split(" ").join(",");
        } else {
            resultString = orField.split(" ").join(" OR ");
        }

        humanQueryString[keywordsSetNumber] = orField.split(" ").join(" <u>OR</u> ");
    // 3. Only the AND field is set => returns a space-separated string.
    } else if (andField) {
        // Just gets the AND field value, since words are already space-separated.
        resultString = andField;
        humanQueryString[keywordsSetNumber] = andField.split(" ").join(" <u>AND</u> ");
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

    // This event is triggered when the user click on a new Bootstrap's tab, in
    // order to avoid a map's display bug (since the map of this tab is either hidden
    // by default or received a lot of changes since the last display, the system
    // does not know how to react).
    // It simply refresh the concerned map.
    $('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
        if (searchMaps.staticMap) {
            searchMaps.staticMap.invalidateSize(false);
            $(".leaflet-draw-draw-circle").tooltip("show");
        }

        if (resultMaps[STREAMING_MODE_IDENTIFIER]) {
            resultMaps[STREAMING_MODE_IDENTIFIER].invalidateSize(false);
        }
    })

    // Loads the counties list.
    loadCountriesList();
    // Loads the languages list.
    loadLanguagesList();
    // Displays the minimum date of the static search, which corresponds to the date it
    // was 9 days ago.
    $("#maxDaysStaticSearch").text(MAX_DAYS_STATIC_SEARCH);
    $("#dateOneWeekAgo").text(moment().subtract(MAX_DAYS_STATIC_SEARCH, 'd').format('YYYY-MM-DD'));
    // Displays the right date format as a placeholder for the dates fields.
    $("#staticFromDate, #staticToDate").attr("placeholder", DATE_FORMAT);
    // Loads the date picker on the date fields.
    $("#staticFromDate, #staticToDate").pickadate({
        "format": "yyyy-mm-dd",
        min: moment().subtract(MAX_DAYS_STATIC_SEARCH, 'd').toDate(),
        max: new Date()
    });

    $("#viewStaticResultsBtn").prop("disabled", false);
    $("#importedFile").prop("disabled", false);

    // Loads maps.
    // The user can draw a rectangle but no circle in the dynamic map.
    loadSearchMap("dynamicMap", true, false);
    // The user can draw a circle but no rectangle in the static map.
    loadSearchMap("staticMap", false, true);

    // Hides the error panel and shows and resets the upload's progress bar when the user choosed a file to upload.
    $("#importedFile").change(function() {
        $("#uploadError").hide();
        $("#progressUpload").show();
        $("#progressBarUpload").css("width", "0%");
        $("#uploadPercents").text(0);
        $("#importedFile").prop("disabled", true);

        $("#dynamicModeSearch").fadeOut("fast");
    })

    // Uploads, parses and validates the file to upload and get its data when the user choosed a file to upload.
    // The blueimp's "jQuery-File-Upload" library (https://github.com/blueimp/jQuery-File-Upload) is used in
    // order to upload the file with Ajax and display a progress bar.
    // The URL of the route to which we send the file is determinated by the input file's data-url attribute.
    $('#importedFile').fileupload({
        dataType: 'json',
        done: function (e, data) {
            // Checks if the server sent us back an error.
            if (data.result.error) {
                var errorMessage = "<span aria-hidden='true' class='fa fa-exclamation-circle'></span> ";

                switch (data.result.reason) {
                    case "missingFile":
                        errorMessage += "You have to upload a file in order to access this feature.";
                        break;
                    case "fileEmpty":
                        errorMessage += "The file you are trying to upload is empty.";
                        break;
                    case "wrongFormat":
                        errorMessage += "The file you are trying to upload is not a proper GeoTwit (.gt) file.";
                        break;
                    case "fileNotValid":
                        errorMessage += "The file you are trying to upload is not valid. Please upload a file generated by GeoTwit.";
                        break;
                    default:
                        errorMessage += "An error occurred, please retry in a while.";
                        break;
                }

                $("#progressUpload").hide();
                $("#uploadError").html(errorMessage);
                $("#uploadError").fadeIn();
                $("#importedFile").prop("disabled", false);
                $("#dynamicModeSearch").fadeIn("fast");
            } else {
                console.log(data.result);
                $("#searchContent").hide();
                $("#streamingResults").fadeIn();
                loadFileResultsComponents(data.result);
            }
        },
        progressall: function (e, data) {
            var progress = parseInt(data.loaded / data.total * 100, 10);
            $("#progressBarUpload").css("width", progress + "%");
            $("#uploadPercents").text(progress);
        }
    });

    $("#streamingDefaultArea").change(function() {
        var selectedCountryName = $("#streamingDefaultArea option:selected").val();
        // Draws a polygon on the selected country on the map.
        selectCountryOnMap(selectedCountryName, searchMaps.dynamicMap);

        // Remove the tooltip of the rectangle's drawing when the user selects
        // a country with the drop-down box.
        if (selectedCountryName) {
            $(".leaflet-draw-draw-rectangle").tooltip("hide");
        } else {
            $(".leaflet-draw-draw-rectangle").tooltip("show");
        }
    });

    $("#startStreamingBtn").click(function() {
        $("#errorDynamicSearch").hide();

        // Validates the search fields.
        var fieldsValidationStatus = validateDynamicFields();

        // If all fields were valid, starts the streaming process.
        if (fieldsValidationStatus === SUCCESS_STATUS) {
            // Deletes the current user's file if it was not already deleted.
            deleteFile();
            initWebSocket();
        // If there was an error, displays it.
        } else {
            $("#errorDynamicSearch").html("<span aria-hidden='true' class='fa fa-exclamation-circle'></span> " + fieldsValidationStatus)
            $("#errorDynamicSearch").fadeIn();
        }
    })

    $("#viewStaticResultsBtn").click(function() {
        $("#errorStaticSearch").hide();

        // Validates the search fields.
        var fieldsValidationStatus = validateStaticFields();

        // If all fields were valid, asks the server for the resultd.
        if (fieldsValidationStatus === SUCCESS_STATUS) {
            getStaticTweets();
        } else {
            $("#errorStaticSearch").html("<span aria-hidden='true' class='fa fa-exclamation-circle'></span> " + fieldsValidationStatus)
            $("#errorStaticSearch").fadeIn();
        }
    })

    $("#btnStopStreaming").click(function() {
        // Stops the streaming process and indicates it to the server.
        stopStreaming(true);
    })
})
