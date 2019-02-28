var parking= angular.module('parking', ['leaflet-directive','angular-chartist']);
var endpoint = 'http://tomcat.testingmachine.eu/parking2/rest/';
var geoserver_parking = 'https://ipchannels.integreen-life.bz.it/geoserver/integreen/ows';
parking.config(function ($sceDelegateProvider,) {
	$sceDelegateProvider.resourceUrlWhitelist([
		'self',                    // trust all resources from the same origin
		'*://ipchannels.integreen-life.bz.it/**'
	]);
});
parking.run(function($rootScope){
	var lang = navigator.language || navigator.userLanguage;
	$rootScope.lang = lang.split('-')[0];
	$rootScope.i18n = i18n;
	moment.locale($rootScope.lang);
	$rootScope.moment=moment;
	if (!$rootScope.i18n[$rootScope.lang])
	lang = 'en';
	$rootScope.$watch('lang',function(newLocale){
		if (newLocale)
		moment.locale(newLocale);
	});

});
parking.controller('parking',function($scope,$http,$interval,$window,leafletData,$filter,$q){
	var self = $scope;
	function startApp(position){
		self.currentPosition = position;
		self.getStations(self.getAllPredictions);
	};
	function startAppWithoutLocation(){
		self.getStations(self.getAllPredictions);
	}
	self.conditionalSorting = function(obj){
		if (self.currentPosition && obj.latitude && obj.longitude){
			var distance = geolib.getDistance(
				{longitude:self.currentPosition.coords.longitude,latitude:self.currentPosition.coords.latitude},
				{longitude:obj.longitude,latitude:obj.latitude});
				return distance;
			} else {
				if (obj.current)
				return obj.current.timestamp *-1;
				else return 0;
			}
		}
		self.getAllPredictions = function(){
			if (self.stations && self.stations.length>0){
				self.stations.forEach(function(value,index){
					self.getPrediction(value.id,240);
				});
			}
		}
		self.filterByCity = function(station){
			if (station.municipality in self.mMap)
			return self.mMap[station.municipality];
			return false;
		}
		self.init = function(){
			var geoLocation = navigator.geolocation.getCurrentPosition(startApp,startAppWithoutLocation); //first parameter success callback, second fail callback
			angular.extend(self, {
				southTyrol: {
					lat: 46.629849,
					lng: 11.3711693 ,
					zoom: 11
				},
				geojson:{
				},
				layers:{
					baselayers: {
						osm: {
							name: 'OpenStreetMap',
							type: 'xyz',
							url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
							layerOptions: {
								subdomains: ['a', 'b', 'c'],
								attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
								continuousWorld: true
							}
						},
					}
				}
			});
			$interval(self.getCurrentData,1000*60);
			$interval(self.getStations,1000*60*60);
			$interval(self.getAllPredictions,1000*60*30);
		}
		self.getStations = function(callback){
			$http.get(endpoint+'get-station-details').then(function(response){
				if (response.status==200){
					self.stations = response.data;
					for (i in response.data){				//create city Map
						var m = response.data[i].municipality;
						if (!(m in self.mMap)){
							self.mMap[m]=false;
						}
					}
					self.getCurrentData(callback);
				}
			});
		}
		self.getCurrentData = function(callback){
			if (self.stations){
				self.stations.forEach(function(item,index){
					var config ={
						params:{
							station:item.id,
							type:'free'
						}
					}
					$http.get(endpoint+'get-newest-record',config).then(function(response){
						if (response.status==200){
							if (!item.current)
								item.current={};
							item.current.value=response.data.value;
							if (response.data.timestamp<new Date().getTime()){
								item.current.timestamp=response.data.timestamp;
							}
						}
					});
				});
				if (callback && (typeof callback == "function")) callback();
			}
		}
		self.getPrediction = function(stationid,minutesTo){
			var datamap = {};
			var now = new Date().getTime();
			var counter = 30;
			var asyncRequests= [];
			while (counter <= minutesTo){
				asyncRequests.push(asyncTypeByRetrival(stationid,counter));
				counter+=30;
			}
			$q.all(asyncRequests).then(drawChart);
			function asyncTypeByRetrival(stationid,minutesTo){
				return $q(function(resolve,reject){
					var config = {
						params:{
							station:stationid,
							name:'parking-forecast-' + minutesTo,
							from:now,
							to: now + 60 * 1000 * minutesTo,
						}
					}
					$http.get(endpoint + "get-records-in-timeframe",config).then(function(response){
						if (response.data && response.data.length>0){
							var newestRecord = response.data[response.data.length-1];
							if (newestRecord.value<0)	//check for unrealistic values
								newestRecord.value = 0;
							datamap[newestRecord.timestamp] = newestRecord;
							resolve();
						}
						resolve();
					});
				});
			}
			function drawChart(){
				var data = [];
				for (key in datamap){
					var point = {x:new Date(datamap[key].timestamp),y:datamap[key].value};
					data.push(point);
				}
				var series = [{name:'station'+stationid, data:data}];
				if ( !self.chartData)
					self.chartData={};
				self.chartData[stationid]={series:series};
				self.options={
					axisX: {
						type: Chartist.FixedScaleAxis,
						divisor: 5,
						labelInterpolationFnc: function(value) {
							return moment(value).format('HH:mm');
						}
					}
				}
			}
		}

		self.getLocation = function() {
			leafletData.getMap('map').then(function(map) {
				map.locate({setView: true, maxZoom: 15, watch: false, enableHighAccuracy: true});
			});
		}
		self.getWFSLayer = function(){
			self.updateAllPopUps = function(stations,feature,layer){
				if (stations ){
					stations.forEach(function(station,index){
						if (station.id == feature.properties.stationcode && station.current){
							var html =
							'<div class="carpark">' +
							'<div class="carpark-aux">' +
							'<h2>'+station.name+'</h2>' +
							'<ul>' +
							'<li class="address"><a target="_blank" href="https://maps.google.com?saddr=Current+Location&mode=driving&daddr=' + station.latitude+','+station.longitude + '">'+ (station.mainaddress?station.mainaddress:self.i18n[self.lang].not_available) +'</a></li>' +
							'<li class="phone"><span>'+ (station.phonenumber?station.phonenumber:self.i18n[self.lang].not_available) + '</span></li>' +
							'</ul>' +
							'<div class="slots">' +
							'<strong class="available-slots '+ (station.current.value>10?'available ':''+station.current.value<=15&&station.current.value>0?'almost-full ':''+
							station.current.value == 0 ? 'full':'') +'">'+
							'<span class="number">'+ station.current.value + '</span>' +
							'<span class="value_type">'+self.i18n[self.lang].free_slots+'</span><span class="value_time"></span>' +
							'</strong>'+ self.i18n[self.lang].out_of + ' <strong>' + station.capacity + ' ' + self.i18n[self.lang].available_slots + '</strong><br/>' +
							'updated <span>' + moment(station.current.timestamp).fromNow() + '</span>' +
							'</div>'+
							'</div>' +
							'</div>'
							layer.bindPopup(html);
							return;
						}
					});
				}
			}
			var defaultParameters = {
				service: 'WFS',
				version: '1.1.0',
				request: 'GetFeature',
				typeName: 'integreen:V2-Parking',
				maxFeatures: 200,
				outputFormat: 'text/javascript',
				srsName:'EPSG:4326',
				format_options:'callback:angular.callbacks._' + $window.angular.callbacks.$$counter, //workaround for strange geoserver requestparams
			};
			$http.jsonp(geoserver_parking,{params : defaultParameters}).then(function(response){
				if (response.status==200){
					angular.extend(self.geojson, {
						parking :{
							data: response.data,
							pointToLayer: function(feature, latlng) {
								var image =  'marker-icon-grey.png';
								var current = feature.properties.occupacypercentage;
								if (current <90)
								image = 'marker-icon-green.png';
								else if (current>=90 && current<100) {
									image = 'marker-icon-yellow.png';
								}else if (current == 100)
								image = 'marker-icon-red.png'
								return new L.Marker(latlng, {
									icon:L.icon({
										iconUrl: 'images/'+image,
										// iconSize: [38, 95],
										iconAnchor: [25, 41],
										popupAnchor: [-18,  -50]
									})
								});
							},
							onEachFeature: function(feature,layer){
								if (feature.properties && feature.properties.stationcode){
									self.$watch('stations',function(stations){
										self.updateAllPopUps(stations,feature,layer);
									},true);
									self.$watch('lang',function(lang){
										self.updateAllPopUps(self.stations,feature,layer);
									});
								}
							}
						}
					});
				}
			});
		}
	});
