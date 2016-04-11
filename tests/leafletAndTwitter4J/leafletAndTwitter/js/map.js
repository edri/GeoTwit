window.onload = function() {
    // Set the default map's values (coordinates and zoom's value).
    swissMap = L.map('swissMap').setView([46.783, 8.152], 8);

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
    });
}

// This function draws a circle on the map by the user's inputs.
function addCircle() {
    L.circle([document.getElementById('circleCoordinatesX').value, document.getElementById('circleCoordinatesY').value], (document.getElementById('circleRadius').value * 1000), {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.5
    }).addTo(swissMap);
}

// This function draws a rectangle on the map by the user's inputs.
function addRectangle() {
    var bounds = [[document.getElementById('squareSWCoordinatesX').value, document.getElementById('squareSWCoordinatesY').value],
                  [document.getElementById('squareNECoordinatesX').value, document.getElementById('squareNECoordinatesY').value]];

    L.rectangle(bounds, {color: "#ff7800", weight: 1}).addTo(swissMap);

    // Zoom the map to the rectangle bounds.x.
    swissMap.fitBounds(bounds);
}

// Add a marken to the map by the user's inputs.
function addMarker() {
    L.marker([document.getElementById('markerCoordinatesX').value, document.getElementById('markerCoordinatesY').value]).addTo(swissMap);
}

function addTweetOnMap(lat, long) {
    L.marker([lat, long]).addTo(swissMap);
}
