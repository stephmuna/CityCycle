//import D3 as an ESM module
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1Ijoic3RlcGhtdW5hIiwiYSI6ImNtaTA0azNmOTBxdjUyaXB5d2VuZXdtODcifQ.F3hqLMSFtNy78I_aSq0L0w';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point); // Project to pixel coordinates
    return { cx: x, cy: y }; // Return as object for use in SVG attributes
  }

 
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// compute arrivals, departures, total traffic for each station
function computeStationTraffic(stations, trips) {
  // departures
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  // arrivals
  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  // add metrics to each station
  return stations.map((station) => {
    const id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// helper: minutes since midnight for a Date
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// filter trips around a selected time
function filterTripsByTime(trips, timeFilter) {
  return timeFilter === -1
    ? trips
    : trips.filter((trip) => {
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
      });
}

const stationFlow = d3.scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

map.on('load', async () => {
    // -----------------------------
    // Boston Bike Lanes
    // -----------------------------
    map.addSource('boston_route', {
      type: 'geojson',
      data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });
  
    map.addLayer({
      id: 'bike-lanes-boston',
      type: 'line',
      source: 'boston_route',
      paint: {
        'line-color': 'green',
        'line-width': 3,
        'line-opacity': 0.4,
      },
    });
  
    // -----------------------------
    // Cambridge Bike Lanes
    // -----------------------------
    map.addSource('cambridge_route', {
      type: 'geojson',
      data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });
  
    map.addLayer({
      id: 'bike-lanes-cambridge',
      type: 'line',
      source: 'cambridge_route',
      paint: {
        'line-color': 'green',
        'line-width': 3,
        'line-opacity': 0.4,
      },
    });
  
    const svg = d3.select('#map').select('svg');
  
    // these need to be visible to inner functions
    let stations;
    let trips;
    let circles;
    let radiusScale;
  
    try {
      // -----------------------------
      // Stations JSON
      // -----------------------------
      const stationUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
      const jsonData = await d3.json(stationUrl);
      stations = jsonData.data.stations;
  
      // -----------------------------
      // Trips CSV – parse dates here
      // -----------------------------
      trips = await d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
        (trip) => {
          trip.started_at = new Date(trip.started_at);
          trip.ended_at = new Date(trip.ended_at);
          return trip;
        }
      );
  
      // compute traffic metrics once (no filter)
      stations = computeStationTraffic(stations, trips);
  
      // radius scale – initial range for "all trips"
      radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([0, 25]);
  
      console.log('Stations with traffic:', stations);
  
      
      circles = svg
        .selectAll('circle')
        .data(stations, (d) => d.short_name)
        .enter()
        .append('circle')
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8)
        .style('--departure-ratio', d =>
            stationFlow(d.departures / d.totalTraffic || 0)
          )
        .style('fill', 'var(--color)')
        .style('pointer-events', 'auto')
        .each(function (d) {
          d3.select(this)
            .append('title')
            .text(
              `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
            );
        });
  
      
      function updatePositions() {
        circles
          .attr('cx', (d) => getCoords(d).cx)
          .attr('cy', (d) => getCoords(d).cy);
      }
  
      updatePositions();
  
      map.on('move', updatePositions);
      map.on('zoom', updatePositions);
      map.on('resize', updatePositions);
      map.on('moveend', updatePositions);
  
      // -----------------------------
      // Slider + time display elements
      // -----------------------------
      const timeSlider = document.getElementById('time-slider');
      const selectedTime = document.getElementById('time-display');
      const anyTimeLabel = document.getElementById('any-time');
  
      let timeFilter = -1; // global-ish for this load
  
      // -----------------------------
      // Update scatter (circle sizes) based on time filter
      // -----------------------------
      function updateScatterPlot(timeFilter) {
        // 1. filter trips
        const filteredTrips = filterTripsByTime(trips, timeFilter);
  
        // 2. recompute traffic for stations using filtered trips
        const filteredStations = computeStationTraffic(stations, filteredTrips);
  
        // 3. adjust radius scale range depending on filter
        if (timeFilter === -1) {
          radiusScale.range([0, 25]);
        } else {
          radiusScale.range([3, 50]);
        }
  
        // 4. update circles with keyed data join
        circles = circles
          .data(filteredStations, (d) => d.short_name)
          .join('circle')
          .attr('r', (d) => radiusScale(d.totalTraffic))
          .style('--departure-ratio', d =>
            stationFlow(d.departures / d.totalTraffic || 0));
  
        // re-attach tooltips in case join ever recreates any circles
        circles.each(function (d) {
          d3.select(this).selectAll('title').remove();
          d3.select(this)
            .append('title')
            .text(
              `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
            );
        });
  
        // keep positions in sync (in case anything changed)
        updatePositions();
      }
  
      // -----------------------------
      // Step 5.2 – slider reactivity
      // -----------------------------
      function updateTimeDisplay() {
        timeFilter = Number(timeSlider.value);
  
        if (timeFilter === -1) {
          selectedTime.textContent = '';
          anyTimeLabel.style.display = 'block';
        } else {
          selectedTime.textContent = formatTime(timeFilter);
          anyTimeLabel.style.display = 'none';
        }
  
        // update map circles to reflect new filter
        updateScatterPlot(timeFilter);
      }
  
      timeSlider.addEventListener('input', updateTimeDisplay);
      // initialize UI + circles
      updateTimeDisplay();
    } catch (error) {
      console.error('Error loading data:', error);
    }
  });
  
  