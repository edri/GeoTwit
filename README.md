![geotwit-logo](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/logo.png)

GeoTwit is an application, which allows you to visualize real-time activities on Twitter's subjects with a map.

## Documentation

- You can find my report thesis [here](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/thesis.pdf).
- You can find documentation about the application right [here](https://github.com/edri/GeoTwit/blob/master/app/GeoTwit/README.md).
- You can find the (french) poster of the applicaiton [here](https://github.com/edri/GeoTwit/blob/master/doc/affiche/affiche_miguel_santamaria.pdf)

## Images

Here are some images of the application:

- Home page
  ![home-page](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/home-page.png)

- Static search results containing:

  1. the human-comprehensive values of the keywords set / subjects, identified by colors: blue for the first subject (always displayed), and orange for the second one (only displayed if you set the second keywords set);
  2. the language used to filter the incoming tweets;
  3. the number of received geolocated and non-geolocated tweets for each subject;
  4. the map, in which you can see the retrieved tweets grouped by clusters; once you zoom the map enough (a zoom level of 8 or more), these clusters disappear and you can access the tweets one by one. By moving the cursor over a marker, the related tweet’s content is displayed, like in the dynamic mode.
  5. a panel that contains all (both with and without geolocation tags) the retrieved tweet’s content.
 
  ![static-results](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/static-results.png)

- Streaming search results containing:

  1. the hh:mm:ss time elapsed since the beginning of the process;
  2. the language used to filter the incoming tweets;
  3. the human-comprehensive values of the keywords set / subjects, identified by colors: blue for the first subject (always displayed), and orange for the second one (only displayed if you set the second keywords set);
  4. a tabs system that allows you to navigate through the ”map” and ”charts” (see next image) views:
  5. the number of received tweets for each subject;
  6. the speed value of the reception for each subject;
  7. a panel that contains the last 100 received tweet’s content.

  ![streaming-process](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/streaming-process.png)

- Streaming search chart view:

  The colors of the elements are the same as their related subjects. These charts are firstly refreshed each second until 60 seconds, then each minute. When you move the cursor over a graph’s element, you will get more information.

  ![charts](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/charts.png)

## Concrete cases

- Do people tweet more about job or beach?

  ![load-test-streaming-map](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/load-test-streaming-map.png)
  ![load-test-streaming-charts](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/load-test-streaming-charts.png)

- What is the impact of Pokemon GO over the world?

  ![analysis-pokemon-go-world-map.jpg](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/analysis-pokemon-go-world-map.jpg)

- Who between France and Portugal wrote the most Tweets during the Euro 2016 final?

  ![analysis-euro2016-final-europe-map.jpg](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/analysis-euro2016-final-europe-map.jpg)
  ![analysis-euro2016-final-europe-charts](https://github.com/edri/GeoTwit/blob/master/doc/reports/latex_thesis/figures/analysis-euro2016-final-europe-charts.jpg)
