// "require" code is normally only usable in Node.js, but we bundle it with the
// amazing "browserify" library!
// If you update this file you have to install "browserify" (npm install -g browserify)
// and then just have to type "browserify map.js -o bundle.js".
// Load the "which-country" library, which allows us to get the country's ISO of a
// given coordinate.
var wc = require('which-country');
// Load the "world-countries" library, which allows us to have a country's english
// name by its ISO.
var countries = require('world-countries');
// Will contain all the coordinates of the polygon representing the selected country.
var polygonCoordinates = [];

var byISO = {};

// Get each country's ISO and store it in an array.
countries.forEach(function (country) {
  byISO[country.cca3] = country;
});

/**
* Indicates whether the given point is located (true) or not (false) in the polygon
* representing the selected country.
* This function is directly inspired by the substack's "point-in-polygon" MIT library,
* available on GitHub right here: https://github.com/substack/point-in-polygon.
* More explanations about this algorithm are available right here:
* https://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
*/
function isPointInSelectedArea(lat, lng) {
    console.log("LAT: " + lat + " - LNG: " + lng);

    var inside = false;

    for (var i = 0; i < polygonCoordinates.length; ++i) {
        for (var j = 0, k = polygonCoordinates[i].length - 1; j < polygonCoordinates[i].length; k = j++) {
            var xi = polygonCoordinates[i][j][0], yi = polygonCoordinates[i][j][1];
            var xj = polygonCoordinates[i][k][0], yj = polygonCoordinates[i][k][1];

            var intersect = ((yi > lng) != (yj > lng))
                && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
    }

    return inside;
}

window.onload = function() {
    // Set the default map's values (coordinates and zoom's value).
    swissMap = L.map('swissMap').setView([46.783, 8.152], 8);
    swissMap.doubleClickZoom.disable();

    // Load the map's imagery with Mapbox.
    L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token={accessToken}', {
        attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery &copy; <a href="http://mapbox.com">Mapbox</a>',
        maxZoom: 20,
        id: 'edri.pjdcfni6',
        accessToken: 'pk.eyJ1IjoiZWRyaSIsImEiOiJjaW1tN2FhM3UwMDJheDdrbGI4MXJnbTZ0In0.upezaa8cZbUkDRoHRwInMA'
    }).addTo(swissMap);

    // Catch the "click" event on the map, save the coordinates and add a marker on the map.
    swissMap.on('click', function(e) {
        document.getElementById('circleCoordinatesX').value = e.latlng.lat;
        document.getElementById('circleCoordinatesY').value = e.latlng.lng;
        L.marker([e.latlng.lat, e.latlng.lng]).addTo(swissMap);

        document.getElementById("isContained").innerText = (isPointInSelectedArea(e.latlng.lat, e.latlng.lng) ? "Yes!" : "No.");
    });

    // Catch a double-click on the map, get the clicked country and then add a polygon
    // all around it.
    swissMap.on('dblclick', function(e) {
        // Get the clicked country's ISO.
        var countryISO = wc([e.latlng.lng, e.latlng.lat]);

        if (countryISO) {
            // Get the country's english name by its ISO.
            var countryName = byISO[countryISO].name.common;
            console.log("The user clicked on " + countryName + ".");

            if (countryName) {
                // Deal world's borders data to display a polygon on the clicked country.
                // First convert the shapefile file is GeoJSON and get the data.
                shp('data/TM_WORLD_BORDERS-0.3').then(function(geojson) {
                    // Then search for the right clicked country.
                    geojson.features.forEach(function(obj) {
                        if (obj.properties.NAME == countryName) {
                            //console.log(obj);
                            var tmp = new Array();

                            // Once the country has been found, there is two cases:
                            //    1. the country owns only one territory (like
                            //       Switzerland): Polygon type.
                            //    2. the country owns multipke territories (like
                            //       France): MultiPolygon type.
                            // We have to differenciate both types, because of
                            // the structures, which are not the same.
                            if (obj.geometry.type == "Polygon") {
                                obj.geometry.coordinates[0].forEach(function(coord) {
                                    tmp.push([coord[1], coord[0]]);
                                })

                                L.polygon(tmp).addTo(swissMap);

                                // Adds the coordinates of the new polygon in the array of polygons' coordinates.
                                polygonCoordinates.push(tmp);
                            } else if (obj.geometry.type == "MultiPolygon") {
                                // Iterate over each country's territories.
                                for (var i = 0; i < obj.geometry.coordinates.length; ++i) {
                                    // Add each territory one by one on the map.
                                    for (var j = 0; j < obj.geometry.coordinates[i][0].length; ++j) {
                                        tmp.push([obj.geometry.coordinates[i][0][j][1], obj.geometry.coordinates[i][0][j][0]]);
                                    }

                                    L.polygon(tmp).addTo(swissMap);
                                        // Adds the coordinates of the new polygon in the array of polygons' coordinates.
                                        polygonCoordinates.push(tmp);
                                    tmp = [];
                                }
                            }

                            return;
                        }
                    })
                });
            }
        }
    });
}
