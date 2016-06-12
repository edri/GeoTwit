// Check if WebSocket is supported by the user's browser and if connection has not already been initialized.
if ("WebSocket" in window) {
    // Will contain the access token grant-URL.
    var url = null;

    // Return current time as a "[HH:MM:SS]" format.
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

    function resetInterface() {
        document.getElementById("streamingBtn").style.display = "block";
        document.getElementById("waitSpan").style.display = "none";
        document.getElementById("stopStreamingBtn").disabled = true;
        document.getElementById("stopStreamingBtn").style.display = "none";
    }

    console.log("Init socket...");
    connection = new WebSocket("ws://localhost:8080/twitter4jWeb/");

    connection.onopen = function() {
        console.log("Socket connection successfully opened!");
    };

    connection.onclose = function() {
        console.log("Socket connection closed.");
        alert("WebSocket connection lost, please check that the Java's websocket-server is running and refresh the page.")
        resetInterface();
        document.getElementById("streamingBtn").disabled = true;
    };

    // Log errors.
    connection.onerror = function(error) {
        alert("A websocket error occured, please check that the Java's websocket-server is running and refresh the page.");
        document.getElementById("streamingBtn").disabled = true;
    };

    // Log messages from the server and deal with each type of possible message.
    connection.onmessage = function(e) {
        console.log("Receive socket message from server: " + e.data);
        var data = JSON.parse(e.data);

        switch(data.message) {
            case "incorrectPin":
                alert("The pin you entered is incorrect, please retry.");
            // Ask the user to get the application's PIN and send it to the Java server.
            case "askAccessToken":
                var pin = null;

                // Get the URL if not null (is null when the user typed a wrong pin).
                if (data.url != undefined) {
                    url = data.url;
                }

                do {
                    pin = window.prompt("Open the following URL, grant access to your account and enter the received PIN:\n" + url);
                } while (!pin)

                connection.send(JSON.stringify({
                    message: "accessTokenPin",
                    pin: pin
                }));

                break;
            // Received if the server's token and configuration's initializations
            // has been successful.
            case "successfulInit":
                document.getElementById("streamingBtn").disabled = true;
                document.getElementById("streamingBtn").style.display = "none";
                document.getElementById("waitSpan").style.display = "none";
                document.getElementById("stopStreamingBtn").disabled = false;
                document.getElementById("stopStreamingBtn").style.display = "block";
                document.getElementById("tweetsDetailsTr").style.visibility = "visible";
                document.getElementById("waitingForTweetsText").textContent = getCurrentTime() + " Waiting for Tweets...";
                break;
            // Occurs when new Tweet's data are coming from the server.
            case "newTweet":
                // Add the new Tweet in the map.
                addTweetOnMap(data.latitude, data.longitude);
                // Add the new Tweet in the Tweets list.
                var divTweet = document.createElement("div");
                divTweet.innerHTML = getCurrentTime() + " " + data.user + " : " + data.content + "<br/>";
                divTweet.className = "tweetInfo";
                var child = document.getElementById("tweetsDetailsTitle");
                child.parentNode.insertBefore(divTweet, child.nextSibling);
                break;
            case "stats":
                // Add the new stats messages in the Tweets list.
                var divTweet = document.createElement("div");
                divTweet.innerHTML = getCurrentTime() + " " + data.content1 + "<br/>" + getCurrentTime() + " " + data.content2 + "<br/><br/>";
                divTweet.className = "tweetInfo";
                var child = document.getElementById("tweetsDetailsTitle");
                child.parentNode.insertBefore(divTweet, child.nextSibling);
                break;
        }
    };

    // Send a "start streaming" socket to the server so it can initialize the process.
    function sendStartStreamingSocket() {
        console.log("Sending \"start streaming\" socket...");

        document.getElementById("streamingBtn").disabled = true;
        document.getElementById("waitSpan").style.visibility = "visible";

        connection.send(JSON.stringify({
            message: "startStreaming"
        }));
    }

    // Send a "stop streaming" socket to the server so it can stop the current
    // streaming.
    function stopStreaming() {
        console.log("Sending \"stop streaming\" socket...");

        resetInterface();
        document.getElementById("waitingForTweetsText").style.display = "none";
        document.getElementById("streamingBtn").disabled = false;

        connection.send(JSON.stringify({
            message: "stopStreaming"
        }));
    }
} else {
    alert("Your web browser does not support WebSocket implementation, please use a recent version of either Firefox or Chrome.")
}
