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
