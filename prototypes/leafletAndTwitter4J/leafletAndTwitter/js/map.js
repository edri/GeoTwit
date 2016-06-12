window.onload = function() {
    // Sometime browsers keep button's status in cache so we have to be sure the
    // Streaming button is enabled.
    document.getElementById("streamingBtn").disabled = false;
    document.getElementById("stopStreamingBtn").disabled = true;

    // Set the default map's values (coordinates and zoom's value).
    // SWISS MAP
    //map = L.map('map').setView([46.783, 8.152], 8);
    // USA MAP
    map = L.map('map').setView([39.155, -97.822], 4);

    // Load the map's imagery with Mapbox.
    L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token={accessToken}', {
        attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery &copy; <a href="http://mapbox.com">Mapbox</a>',
        maxZoom: 20,
        id: 'edri.pjdcfni6',
        accessToken: 'pk.eyJ1IjoiZWRyaSIsImEiOiJjaW1tN2FhM3UwMDJheDdrbGI4MXJnbTZ0In0.upezaa8cZbUkDRoHRwInMA'
    }).addTo(map);

    // Catch the "click" event on the map, save the coordinates and add a marker on the map.
    map.on('click', function(e) {
        document.getElementById('circleCoordinatesX').value = e.latlng.lat;
        document.getElementById('circleCoordinatesY').value = e.latlng.lng;
        L.marker([e.latlng.lat, e.latlng.lng]).addTo(map);
    });
}

// This function draws a circle on the map by the user's inputs.
function addCircle() {
    L.circle([document.getElementById('circleCoordinatesX').value, document.getElementById('circleCoordinatesY').value], (document.getElementById('circleRadius').value * 1000), {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.5
    }).addTo(map);
}

// This function draws a rectangle on the map by the user's inputs.
function addRectangle() {
    var bounds = [[document.getElementById('squareSWCoordinatesX').value, document.getElementById('squareSWCoordinatesY').value],
                  [document.getElementById('squareNECoordinatesX').value, document.getElementById('squareNECoordinatesY').value]];

    L.rectangle(bounds, {color: "#ff7800", weight: 1}).addTo(map);

    // Zoom the map to the rectangle bounds.x.
    map.fitBounds(bounds);
}

// Add a marken to the map by the user's inputs.
function addMarker() {
    L.marker([document.getElementById('markerCoordinatesX').value, document.getElementById('markerCoordinatesY').value]).addTo(map);
}

function addTweetOnMap(lat, long) {
    L.marker([lat, long]).addTo(map);
}
