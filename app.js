"use strict";

const async = require('async');
const request = require('request');
const fs = require('fs');

var config = {},
    data = {
        heating_zone_ids: [],
        zone2devices: {},
        deviceNames: {},
        schedule: {},
        zones: {},
        devices: {},
        address: '',
        lastUpdate: ''
    },
    enabled = true,
    tokens = {},
    timeouts = {};

/**
 * init schedule loop
 */
function initScheduler(callback) {
    // get local address
    Homey.manager('cloud').getLocalAddress(function (err, localAddress) {
        data.address = localAddress;

        // get / init settings
        config = Homey.manager('settings').get('config');
        if (!config) {
            config = {};
            Homey.manager('settings').set('config', config);
        }

        // get config and run instance
        getConfig(function () {
            if (typeof(callback) == 'function') {
                callback();
            }
        });
    });
}

/**
 * read all required configs
 * @param callback
 */
function getConfig(callback) {
    // reset variables
    for (var key in data) {
        if (Array.isArray(data[key])) data[key] = [];
        else if (typeof(data[key]) == 'object') data[key] = {};
    }

    // read zones
    api('/manager/zones/zone/?recursive=1', function (zonesData) {
        // add zones
        data.zones = {
            0: zonesData
        };

        api('/manager/devices/device/', function (devicesData) {
            Homey.log('----------------------------');
            data.devices = devicesData;

            // add heating devices & -zones
            addHeatingDevices();
            addHeatingZones();

            // prepare scheduled devices
            prepareScheduledDevices(data.zones);

            // save update timestamp
            data.lastUpdate = new Date().getTime();

            // run schedule every minute
            if (typeof(callback) == 'function') {
                callback();
            }
        });
    });
}

/**
 * run scheduler
 */
function doSchedule() {
    // check for config changes
    var liveConfig = Homey.manager('settings').get('config'),
        time = new Date().getTime(),
        diff = Math.ceil((time - data.lastUpdate) / 1000);

    if (liveConfig.updated != config.updated || diff > (60 * 10)) {
        log('Reload config...', true, (liveConfig.updated != config.updated));

        config = liveConfig;
        getConfig(function () {
            doSchedule();
        });

        return false;
    }

    // check schedule and update target temperatures
    var now = new Date(),
        day = getWeekDay(),
        hour = now.getHours(),
        minute = now.getMinutes(),
        hh = ('0' + hour).slice(-2),
        mm = ('0' + minute).slice(-2);

    log('Checking schedule for ' + getWeekDay(true) + ', ' + hh + ':' + mm + '...', false, true);

    if (data.schedule.hasOwnProperty(day)) {
        for (var device_id in data.schedule[day]) {
            var device_hours = data.schedule[day][device_id];

            // hour lookup
            if (device_hours.hasOwnProperty(hour)) {
                var device_minutes = device_hours[hour];

                // minute lookup
                if (device_minutes.hasOwnProperty(minute)) {
                    // temperature to set
                    var device_temperature = device_minutes[minute];
                    if (device_temperature > 0) {
                        // trigger temperature update
                        triggerTemperatureUpdate(device_id, device_temperature);
                    }
                }
            }
        }
    }
}

/**
 * Helper: check for empty objects
 * @param obj
 * @returns {boolean}
 */
function isEmptyObject(obj) {
    return typeof(obj) != 'object' || obj == null || !Object.keys(obj).length;
}

/**
 * Helper: get day name
 * @returns {string}
 */
function getWeekDay(full_names) {
    var weekday = full_names
        ? ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
        : ["su", "mo", "tu", "we", "th", "fr", "sa"];
    return weekday[new Date().getDay()];
}

/**
 * prepare scheduled devices
 * @param zones
 */
function prepareScheduledDevices(zones) {
    for (var zone_id in zones) {
        var zone = zones[zone_id];

        if (config.schedule.hasOwnProperty(zone.id) && data.zone2devices.hasOwnProperty(zone.id)) {
            var zone_schedule = config.schedule[zone.id];

            if (zone_schedule.enabled) {
                // get settings by day
                for (var day in zone_schedule.plan) {
                    var plan = zone_schedule.plan[day];
                    if (!data.schedule.hasOwnProperty(day)) {
                        data.schedule[day] = {};
                    }

                    // set / reset settings by device
                    var devices = data.zone2devices[zone.id];
                    for (var d = 0; d < devices.length; d++) {
                        var device_id = devices[d];

                        // set / reset settings for device
                        data.schedule[day][device_id] = {};

                        // get settings by daytime
                        for (var daytime in plan) {
                            var dayplan = plan[daytime];
                            if (dayplan.hasOwnProperty('hour')) {
                                // set hour
                                if (!data.schedule[day][device_id].hasOwnProperty(dayplan.hour)) {
                                    data.schedule[day][device_id][dayplan.hour] = {};
                                }

                                // set minute
                                if (!data.schedule[day][device_id][dayplan.hour].hasOwnProperty(dayplan.minute)) {
                                    data.schedule[day][device_id][dayplan.hour][dayplan.minute] = 0;
                                }

                                // set target temperature
                                data.schedule[day][device_id][dayplan.hour][dayplan.minute] = dayplan.temperature;
                            }
                        }
                    }
                }
            }
        }

        if (!isEmptyObject(zone.children)) {
            prepareScheduledDevices(zone.children);
        }

        // cleanup
        for (day in data.schedule) {
            var devices = data.schedule[day];
            for (device_id in devices) {
                var device = data.devices[device_id];
                if (isEmptyObject(device)) {
                    delete data.schedule[day][device_id];
                }
            }

            if (isEmptyObject(data.schedule[day])) {
                delete data.schedule[day];
            }
        }
    }
}

/**
 * add device to zones
 * @param zone_id
 * @param device_id
 * @param parent_id
 */
function addDeviceToZone(zone_id, device_id, parent_id) {
    addToZone(zone_id, device_id);

    // add parent zone too
    addDeviceToParentZones(parent_id, device_id, data.zones);
}

/**
 * finaly adds device to zone
 * @param zone_id
 * @param device_id
 */
function addToZone(zone_id, device_id) {
    data.heating_zone_ids.push(zone_id);

    if (!data.zone2devices.hasOwnProperty(zone_id)) {
        data.zone2devices[zone_id] = [];
    }

    data.zone2devices[zone_id].push(device_id);
}

/**
 * adds device to parent zones
 * @param parent_id
 * @param device_id
 * @param parent_zones
 */
function addDeviceToParentZones(parent_id, device_id, parent_zones) {
    if (parent_id) {
        for (var zone_id in parent_zones) {
            var zone = parent_zones[zone_id];

            if (!isEmptyObject(zone.children)) {
                addDeviceToParentZones(parent_id, device_id, zone.children);
            }

            if (zone.id == parent_id) {
                addDeviceToZone(zone.id, device_id, zone.parent);
            }
        }
    }
}

/**
 * lookup for heating devices in zones
 * capability: 'target_temperature'
 */
function addHeatingDevices() {
    for (var device_id in data.devices) {
        if (data.devices.hasOwnProperty(device_id)) {
            var device = data.devices[device_id];

            if (device.hasOwnProperty('capabilities') && device.capabilities.hasOwnProperty('target_temperature')) {
                data.deviceNames[device.id] = device.name;
                addDeviceToZone(device.zone.id, device.id, device.zone.parent);
            }
        }
    }
}

/**
 * add recursive zones with heating devices, only
 */
function addHeatingZones() {
    // mark zones with heating devices
    function getZonesWithHeatingDevice(zones) {
        for (var zone_id in zones) {
            if (zones.hasOwnProperty(zone_id)) {
                var zone = zones[zone_id];

                if (zone.parent && data.heating_zone_ids.indexOf(zone.id) == -1) {
                    delete zones[zone_id];
                }
                else if (!isEmptyObject(zone.children)) {
                    zones[zone_id].children = getZonesWithHeatingDevice(zone.children);
                }
            }
        }

        return zones;
    }

    // convert & sort zones to array (copy from /manager/zones/js/zones.js)
    function zoneChildrenToArrayRecursive(zone) {
        var children = [];
        for (var zoneId in zone.children) {
            var child = zone.children[zoneId];
            child.children = zoneChildrenToArrayRecursive(child);
            children.push(child);
        }
        children.sort(function (a, b) {
            return a.index > b.index;
        });
        return children;
    }

    data.zones = getZonesWithHeatingDevice(data.zones);
    data.zones[0].children = zoneChildrenToArrayRecursive(data.zones[0]);
}

/**
 * Trigger to update thermostat's temperature
 * @param device_id
 * @param device_temperature
 */
function triggerTemperatureUpdate(device_id, device_temperature, force_update) {
    // save trigger
    var liveConfig = Homey.manager('settings').get('config');
    if (!liveConfig.hasOwnProperty('lastTriggeredTemperature')) {
        liveConfig.lastTriggeredTemperature = {};
    }

    liveConfig.lastTriggeredTemperature[device_id] = device_temperature;
    Homey.manager('settings').set('config', liveConfig);

    // update temperature if schedule is enabled
    if (enabled || force_update) {
        updateTemperature(device_id, device_temperature);
    }
}

/**
 * updates target_temperature of device
 * @param device_id
 * @param target_temperature
 */
function updateTemperature(device_id, target_temperature) {
    var deviceName = data.deviceNames[device_id];

    // unbind timeout, if available
    if (timeouts.hasOwnProperty(device_id)) {
        clearTimeout(timeouts[device_id]);
    }

    // update temperature
    log('Set thermostat "' + deviceName + '" to ' + target_temperature + '°', true, true);

    // trigger flow: thermostat triggered
    Homey.manager('flow').trigger('heatingThermostatTriggered', {
        tokenDeviceTriggered: deviceName + ': ' + target_temperature + '°'
    }, null, function (err, success) {
        if (err) log(err);
        log(['Flow heatingThermostatTriggered:', success], true, true);
    });

    // read thermostat temperature
    api('/manager/devices/device/' + device_id + '/state/', function (data) {
        var current_temperature = data.hasOwnProperty('target_temperature') ? data.target_temperature : false;

        // set temperature
        if (current_temperature && current_temperature != target_temperature) {
            api('/manager/devices/device/' + device_id + '/state/', {
                target_temperature: parseFloat(target_temperature)
            });
        }

        // on current temperature equals target temperature, trigger flow: thermostat updated
        if (current_temperature && current_temperature == target_temperature) {
            temperatureUpdated(device_id, target_temperature);
        }
        // otherwise verify updated temperature after 10s
        else {
            setTimeout(function () {
                verifyTemperature(device_id, target_temperature);
            }, 10000);
        }
    });
}

/**
 * verifies that target temperature has been updated
 * @param device_id
 * @param target_temperature
 */
function verifyTemperature(device_id, target_temperature) {
    // read thermostat temperature
    api('/manager/devices/device/' + device_id + '/state/', function (data) {
        var current_temperature = data.hasOwnProperty('target_temperature') ? data.target_temperature : false;

        // trigger flow, when temperature has been updated
        if (!current_temperature || current_temperature == target_temperature) {
            // unbind timeout, if available
            if (timeouts.hasOwnProperty(device_id)) {
                clearTimeout(timeouts[device_id]);
            }

            // trigger flow: thermostat updated
            temperatureUpdated(device_id, target_temperature);
        }
        // otherwise, verify temperature in 30 seconds again
        else if (current_temperature && current_temperature != target_temperature) {
            timeouts[device_id] = setTimeout(function () {
                verifyTemperature(device_id, target_temperature);
            }, 30000);
        }
    });
}

/**
 * Trigger flow: thermostat updated
 */
function temperatureUpdated(device_id, target_temperature) {
    var deviceName = data.deviceNames[device_id];

    Homey.manager('flow').trigger('heatingThermostatUpdated', {
        tokenDeviceUpdated: deviceName + ': ' + target_temperature + '°'
    }, null, function (err, success) {
        if (err) log(err);
        log(['Flow heatingThermostatUpdated:', success], true, true);
    });

    log('Thermostat "' + deviceName + '" updated to ' + target_temperature + '°.', true, true);
}

/**
 * Run latest schedule for a zone
 * @param zone_id
 * @param zone_name
 */
function triggerLatestZoneSchedule(zone_id, zone_name) {
    log('re-run scheduler for zone ' + zone_name, true, true);
    if (data.zone2devices.hasOwnProperty(zone_id)) {
        var devices = data.zone2devices[zone_id];
        devices.forEach(function (device_id) {
            if (config.hasOwnProperty('lastTriggeredTemperature') && config.lastTriggeredTemperature.hasOwnProperty(device_id)) {
                var device_temperature = config.lastTriggeredTemperature[device_id];
                updateTemperature(device_id, device_temperature);
            }
        });
    }
}

/**
 * Homey rest api wrapper
 * @param path
 * @param json
 * @param callback
 * @returns {boolean}
 */
function api(path, json, callback) {
    if (!data.address || !config.token || !config.token.length) {
        return false;
    }

    var path_raw = path;
    path += path.indexOf('?') > -1 ? '&_=' + (new Date).getTime() : '?_=' + (new Date).getTime();

    var method = 'GET';
    if (typeof(json) == 'function') {
        callback = json;
        json = null;
    }
    else if (typeof(json) == 'object') {
        method = 'PUT';
    }

    log(method + ' ' + path_raw);

    try {
        return request({
            method: method,
            url: 'http://' + data.address + '/api' + path,
            auth: {
                'bearer': config.token
            },
            json: json ? json : true
        }, function (error, response, body) {
            if (typeof(callback) == 'function') {
                callback(typeof(response) == 'undefined' ? {} : body.result);
            }
        });
    } catch (err) {
        log(err, true, true);
    }
}

/**
 * create token for enable / disable schedule
 */
function createTokens() {
    Homey.manager('flow').registerToken('scheduleState', {type: 'boolean', title: 'enabled'}, function (err, token) {
        if (err) log(err, false, true);

        log('[TOKEN] schedule state token created', false, true);

        tokens['enabled'] = token;
        tokens['enabled'].setValue(enabled);
    });
}

/**
 * action flow callbacks
 */
function createActions() {
    // enable / disable schedule
    Homey.manager('flow').on('action.scheduleState', function (callback, args) {
        enabled = (args.enabled == 'enabled') ? true : false;
        tokens['enabled'].setValue(enabled);

        log('[ACTION] scheduler has been [' + (enabled ? 'enabled' : 'disabled') + ']', false, true);

        // run callback
        callback(null, true);
    });

    // update zone's temperature
    Homey.manager('flow').on('action.updateZoneTemperature', function (callback, args) {
        if (args.hasOwnProperty('zone') && data.zone2devices.hasOwnProperty(args.zone.id)) {
            var devices = data.zone2devices[args.zone.id],
                device_temperature = args.action;

            log('[ACTION] updating zone "' + args.zone.name + '" to ' + device_temperature + '°', false, true);

            devices.forEach(function (device_id) {
                updateTemperature(device_id, device_temperature);
            });
        }

        callback(null, true);
    });

    // trigger last zone schedule
    Homey.manager('flow').on('action.triggerLastZoneSchedule', function (callback, args) {
        if (args.hasOwnProperty('zone')) {
            log('[ACTION] triggering last schedule for zone "' + args.zone.name + '', false, true);
            triggerLatestZoneSchedule(args.zone.id, args.zone.name);
        }

        callback(null, true);
    });
}

/**
 * flow conditions
 */
function createConditions() {
    // scheduler is enabled
    Homey.manager('flow').on('condition.scheduleStateEnabled', function (callback) {
        log('[CONDITION] Heating Scheduler is [' + ((enabled === true) ? 'enabled' : 'disabled') + ']', false, true);
        callback(null, (enabled === true));
    });

    // temperature is greater / less than
    Homey.manager('flow').on('condition.zoneTemperature', function (callback, args) {
        if (args.hasOwnProperty('zone') && data.zone2devices.hasOwnProperty(args.zone.id)) {
            var devices = data.zone2devices[args.zone.id],
                urls = [];

            devices.forEach(function (device_id) {
                urls.push('/manager/devices/device/' + device_id + '/state/');
            });

            async.map(urls, function (url, fn) {
                api(url, function (response) {
                    // get measured temperature if available by device, otherwise get target_temperature
                    var temp = response.hasOwnProperty('measure_temperature') ? response.measure_temperature : response.target_temperature;
                    fn(null, temp);
                });
            }, function (err, temperatures) {
                // calculate avg temperature when more than 1 thermostat is used
                var sum = 0, temperature = 0;
                if (temperatures.length) {
                    temperatures.forEach(function (temp) {
                        sum += parseFloat(temp);
                    });

                    // fix temperature to 1 decimal place
                    temperature = (sum / temperatures.length).toFixed(1);
                }

                // log temperature
                log('[CONDITION] Ø Temperature for zone "' + args.zone.name + '": '+ temperature + '°', false, true);

                // trigger homey callback
                callback(null, (temperature > 0 && args.action > temperature));
            });
        }
        else {
            log('[CONDITION] Ø Temperature for zone "' + args.zone.name + '": FAILED!', false, true);
            callback(null, false);
        }
    });
}

/**
 * flow actions autocomplete
 */
function createAutocompletes() {
    Homey.manager('flow').on('action.updateZoneTemperature.zone.autocomplete', getZoneAutocomplete);
    Homey.manager('flow').on('action.triggerLastZoneSchedule.zone.autocomplete', getZoneAutocomplete);
    Homey.manager('flow').on('condition.zoneTemperature.zone.autocomplete', getZoneAutocomplete);
}

/**
 * callback for zone autocompletion
 * @param callback
 * @param args
 */
function getZoneAutocomplete(callback, args) {
    var heating_zones = [];

    // get heating zones
    function getHeatingZones(zones) {
        for (var zone_id in zones) {
            if (zones.hasOwnProperty(zone_id)) {
                var zone = zones[zone_id],
                    devices = [];

                // get device names
                if (data.zone2devices.hasOwnProperty(zone.id)) {
                    data.zone2devices[zone.id].forEach(function (device_id) {
                        var device = data.deviceNames.hasOwnProperty(device_id) ? data.deviceNames[device_id] : false;
                        if (device) {
                            devices.push(device);
                        }
                    });
                }

                // add heating zone
                heating_zones.push({
                    icon: '/manager/zones/assets/icons/' + zone.icon + '.svg',
                    name: zone.name,
                    description: devices.join('<br />'),
                    id: zone.id
                });

                // if zone has childrens, add them too!
                if (!isEmptyObject(zone.children)) {
                    getHeatingZones(zone.children);
                }
            }
        }
    }

    // get all heating zones
    getHeatingZones(data.zones);

    // filter zones
    heating_zones = heating_zones.filter(function (item) {
        return item.name.toLowerCase().indexOf(args.query.toLowerCase()) > -1;
    });

    callback(null, heating_zones);
}

/**
 * log function
 * @param str
 * @param newline
 * @param writeToFile
 */
var log_contents = '';
function log(str, newline, writeToFile) {
    var now = new Date(),
        time = ('0' + now.getHours()).slice(-2) + ':'
            + ('0' + now.getMinutes()).slice(-2) + ':'
            + ('0' + now.getSeconds()).slice(-2),
        log = Array.isArray(str) ? str : [str];

    // prpend time to log
    log.unshift('[' + time + ']');

    // output
    if (newline) Homey.log('----------------------------');
    Homey.log.apply(this, log);
    if (newline) Homey.log('----------------------------');

    // log to file
    var filePath = '/userdata/main.log';

    // create logfile
    if (!log_contents) {
        fs.writeFile(filePath, '');
    }

    // write to log file, if requested
    if (writeToFile) {
        // truncate log file after 100.000 bytes
        fs.stat(filePath, function (err, stat) {
            if (stat && stat.size > 100000) {
                log_contents = '';
                fs.writeFile(filePath, '');
            }
        });

        // prepend log message
        log_contents = log.join(' ') + "\r\n" + log_contents;

        // write log file
        fs.writeFile(filePath, log_contents);
    }
}

/**
 * init heating schedule
 */
module.exports.init = function () {
    log('Starting Heating Schedule...', true, true);

    initScheduler(function () {
        createTokens();
        createActions();
        createConditions();
        createAutocompletes();

        // run schedule
        doSchedule();
    });

    // run scheduler every minute
    setInterval(doSchedule, 1000 * 60);
};
