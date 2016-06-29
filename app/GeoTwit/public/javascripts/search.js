// "require" code is normally only usable in Node.js, but we bundle it with the amazing "browserify" library!
// If you update this file you have to install "browserify" (npm install -g browserify) and then just have
// to type "browserify public/javascripts/search.js -o public/javascripts/search-bundle.js".
// Load the "leaflet-draw-drag" library, which
var drawControl = require('leaflet-draw-drag'); // requires leaflet-draw
var dynamicMap, staticMap;
var rectangleLatLngs;

/**
* Loads all elements related to the dynamic map.
*/
function loadDynamicMap() {
    // Changes a Loaflet.draw's default text.
    L.drawLocal.edit.handlers.edit.tooltip.text = 'Drag handles, or marker to edit feature, then press the <strong><u>SAVE</u></strong> button.';

    // Set dynamic map's values (coordinates and zoom's value).
    // Also load the maps' imagery with OpenStreetMap's hot imagery.
    // You can find a list of imagery providers right here: https://leaflet-extras.github.io/leaflet-providers/preview/.
    dynamicMap = new L.Map("dynamicMap", {center: [46.783, 8.152], zoom: 8})
        .addLayer(new L.tileLayer('http://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            maxZoom: 20,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles courtesy of <a href="http://hot.openstreetmap.org/" target="_blank">Humanitarian OpenStreetMap Team</a>'
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
            southwest: {
                lat: e.layer._latlngs[0].lat,
                lng: e.layer._latlngs[0].lng
            },
            northeast: {
                lat: e.layer._latlngs[2].lat,
                lng: e.layer._latlngs[2].lng
            }
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
            southwest: {
                lat: e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[0].lat,
                lng: e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[0].lng
            },
            northeast: {
                lat: e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[2].lat,
                lng: e.layers._layers[Object.keys(e.layers._layers)[0]]._latlngs[2].lng
            }
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
    staticMap = new L.Map("staticMap", {center: [46.783, 8.152], zoom: 8})
        .addLayer(new L.tileLayer('http://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            maxZoom: 20,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles courtesy of <a href="http://hot.openstreetmap.org/" target="_blank">Humanitarian OpenStreetMap Team</a>'
        }));
}

/**
* Occurs when the page successfully loaded all DOM elements.
*/
$(document).ready(function() {
    // Enable tabs' actions once the page has been successfully loaded.
    $('#searchTabs a').click(function (e) {
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
})
