/*$(document).ready(function() {
    // Enable tabs' actions once the page has been successfully loaded.
    $('#searchTabs a').click(function (e) {
        e.preventDefault();
        $(this).tab('show');
    })
*/
window.onload = function() {
    // Set both dynamic and static maps' values (coordinates and zoom's value).
    dynamicMap = L.map('dynamicMap').setView([46.783, 8.152], 8);
    staticMap = L.map('staticMap').setView([46.783, 8.152], 8);

    // Load the map's imagery with Mapbox.
    L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token={accessToken}', {
        attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery &copy; <a href="http://mapbox.com">Mapbox</a>',
        maxZoom: 20,
        id: 'edri.pjdcfni6',
        accessToken: 'pk.eyJ1IjoiZWRyaSIsImEiOiJjaW1tN2FhM3UwMDJheDdrbGI4MXJnbTZ0In0.upezaa8cZbUkDRoHRwInMA'
    }).addTo(dynamicMap);
}
