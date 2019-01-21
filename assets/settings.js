var IS_DEV = false,
    config = {
        token: '',
        schedule: {},
        lastTriggeredTemperature: {},
        updated: null
    },
    data = {
        zones: {},
        devices: {},
        zone2devices: {},
        heating_zone_ids: [],
        deviceNames: {},
        zones_with_heating_devices: 0
    },
    default_plan = {
        morning: {
            hour: 6,
            minute: 0,
            temperature: -1
        },
        day: {
            hour: 12,
            minute: 0,
            temperature: -1
        },
        evening: {
            hour: 18,
            minute: 0,
            temperature: -1
        },
        night: {
            hour: 23,
            minute: 0,
            temperature: -1
        }
    };

/**
 * when homey is ready, get zones with heating devices
 */
function onHomeyReady() {
    // read config
    Homey.get('config', function (err, configData) {
        if (err) return alert(err);
        if (configData.hasOwnProperty('token')) {
            config = configData;
        }

        // read zones
        api('GET', '/manager/zones/zone/?recursive=1', function (err, zonesData) {
            if (err) return alert(err);

            // add zones
            data.zones = {
                0: zonesData
            };

            // read devices
            api('GET', '/manager/devices/device/', function (err, devicesData) {
                if (err) return alert(err);
                data.devices = devicesData;

                // add heating devices & -zones
                addHeatingDevices();
                addHeatingZones();

                // on empty heating devices, prompt error
                if (!data.heating_zone_ids.length) {
                    $('#bearer_token_form').hide();
                    $('#schedule-config').html('<div class="error"><em class="fa fa-warning"></em> ' + __('no_thermostats_attached') + '</div>');
                }
                // otherwise, run scheduler :-)
                else {
                    // render the zones
                    var items_render = $('#zones-list-template').render(data.zones[0]);
                    $('#zones-list').html(items_render);

                    // hide zones, if only 1 zone with thermostats is available
                    if (data.zones_with_heating_devices == 1) {
                        $('#zones').hide();
                        $('#zones').find('a:first').addClass('enabled');
                    }

                    // init schedule
                    initSchedule();
                }

                // update log every 30s
                readLog();
                setInterval(readLog, 30000);

                // settings are ready now! :-)
                Homey.ready();
            });
        });
    });
}

/**
 * add device to zones
 * @param zone_id
 * @param device_id
 * @param parent_id
 */
function addDeviceToZone(zone_id, device_id, parent_id, initiated) {
    addToZone(zone_id, device_id, initiated);

    // add parent zone too
    addDeviceToParentZones(parent_id, device_id, data.zones);
}

/**
 * finaly adds device to zone
 * @param zone_id
 * @param device_id
 */
function addToZone(zone_id, device_id, initiated) {
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
                addDeviceToZone(device.zone.id, device.id, device.zone.parent, true);
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
                else {
                    data.zones_with_heating_devices++;
                    zones[zone_id].schedule_enabled = (config.schedule.hasOwnProperty(zone.id) && config.schedule[zone.id].enabled);
                    if (!isEmptyObject(zone.children)) {
                        zones[zone_id].children = getZonesWithHeatingDevice(zone.children);
                    }
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
 * Helper: check for empty objects
 * @param obj
 * @returns {boolean}
 */
function isEmptyObject(obj) {
    return typeof(obj) != 'object' || obj == null || !Object.keys(obj).length;
}

/**
 * init scheduler
 */
function initSchedule() {
    // init temperatures
    $('select.temperature').append('<option value="-1">' + __('no_change') + '</option>');
    for (var t = 4; t < 28.5; (t += 0.5)) {
        $('select.temperature').append('<option value="' + t + '">' + t.toFixed(1) + '°C</option>');
    }

    // init hours
    for (var h = 0; h < 24; h++) {
        var hh = (h < 10) ? '0' + h : h;
        $('select.hour').append('<option value="' + h + '">' + hh + '</option>');
    }

    // init minutes
    for (var m = 0; m < 60; m++) {
        var mm = (m < 10) ? '0' + m : m;
        $('select.minute').append('<option value="' + m + '">' + mm + '</option>');
    }

    // enable / disable schedule
    $('#toggle_schedule').change(function () {
        if ($(this).is(':checked')) {
            $('#zones-list a.enabled').addClass('schedule_enabled');
            $('#schedule').removeClass('disabled');
            $('#schedule select').attr('disabled', false);
        }
        else {
            $('#zones-list a.enabled').removeClass('schedule_enabled');
            $('#schedule').addClass('disabled');
            $('#schedule select').attr('disabled', true);
        }

        if ($(this).data('s')) {
            $(this).data('s', false);
        } else {
            saveConfig();
        }
    });

    function hasEnabledChildren(zones, selected_zone_id, selected_device_id) {
        var has_enabled_children = false;

        for (var zone_id in zones) {
            var zone = zones[zone_id];

            if (zone.id == selected_zone_id) {
                if (!isEmptyObject(zone.children)) {
                    has_enabled_children = hasEnabledChildren(zone.children, selected_zone_id, selected_device_id);
                }
                else {
                    has_enabled_children = false;
                }
            }
            else if (!isEmptyObject(zone.children)) {
                has_enabled_children = hasEnabledChildren(zone.children, selected_zone_id, selected_device_id);
            }
            else if (zone.id != selected_zone_id) {
                if (data.zone2devices.hasOwnProperty(zone.id)
                    && data.zone2devices[zone.id].indexOf(selected_device_id) > -1
                    && config.schedule.hasOwnProperty(zone.id)
                    && config.schedule[zone.id].enabled
                ) {
                    has_enabled_children = true;
                }
                else if (!isEmptyObject(zone.children)) {
                    has_enabled_children = hasEnabledChildren(zone.children, selected_zone_id, selected_device_id);
                }
            }
        }

        return has_enabled_children;
    }

    // zones tab
    $('#zones-list a').click(function () {
        $('#zones-list a').removeClass('enabled');
        $(this).addClass('enabled');

        var day = $('#schedule ul a.enabled').data('day');
        loadConfig(day);

        $('#days a:first').click();

        // update zone thermostats
        var zone_id = $(this).data('id');

        if (data.zone2devices.hasOwnProperty(zone_id)) {
            var zone_devices = [];

            data.zone2devices[zone_id].forEach(function (device_id) {
                var device = data.devices[device_id];
                device.disabled = hasEnabledChildren(data.zones, zone_id, device_id);

                zone_devices.push(device);
            });

            var items_render = $('#thermostats-template').render(zone_devices);
            $('#thermostats-list').html(items_render);
            $('#thermostats_headline').html(__(zone_devices.length == 1 ? 'thermostat' : 'thermostats'));
        }
        else {
            $('#thermostats-list').html('<li>-</li>');
        }

        return false;
    });

    // week tab
    $('#schedule ul a').click(function () {
        $('#schedule ul a').removeClass('enabled');
        $(this).addClass('enabled');

        var day = $(this).data('day');
        loadConfig(day);

        $('#copy li').removeClass('copied').removeClass('disabled');
        $('#copy .' + day).addClass('disabled');

        return false;
    });

    // save settings onchange
    $('#schedule select').change(function () {
        saveConfig();
    });

    // select first zone initially
    $('#zones-list a:first').click();

    // set token
    $('#token').val(config.token);

    // save token
    $('#submit_token').click(function () {
        if ($(this).find('em').length) {
            return false;
        }

        $(this).html('<em class="fa fa-cog fa-spin fa-fw"></em>');

        var $this = $(this),
            token = $.trim($('#token').val()),
            first_zone_id = data.zones[0].id;

        if (token.indexOf('bearer_token=') > -1) {
            token = token.split('bearer_token=')[1];
        }

        // verify bearer token
        $.ajax({
            url: (IS_DEV ? 'http://10.0.0.124' : '') + '/api/manager/zones/zone/' + first_zone_id + '/',
            dataType: 'json',
            beforeSend: function(xhr) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            },
            success: function () {
                $this.html('<em class="fa fa-check"></em>');

                window.setTimeout(function () {
                    $('#submit_token').html(__('save'));
                }, 2000);

                // update token
                $('#token').val(token);

                config.token = token;
                Homey.set('config', config);
            },
            error: function () {
                $this.html('<em class="fa fa-times" style="color:red"></em> ' + __('bearer_token_invalid'));

                window.setTimeout(function () {
                    $('#submit_token').html(__('save'));
                }, 2000);

                // clear token
                $('#token').val('');

                config.token = '';
                Homey.set('config', config);
            }
        });
    });
}

/**
 * load settings by config & day
 * @param day
 */
function loadConfig(day) {
    setDefaults();

    var zone_id = $('#zones-list a.enabled').data('id');
    if (config.schedule.hasOwnProperty(zone_id)) {
        var settings = config.schedule[zone_id];

        // enable / disable plan
        $('#toggle_schedule').prop('checked', settings.enabled).data('s', true).change();

        // update individual day settings
        var plan = settings.plan.hasOwnProperty(day) ? settings.plan[day] : default_plan;

        $.each(plan, function (daytime, times) {
            var element = $('#' + daytime);

            if (element.length) {
                $.each(times, function (key, setting) {
                    element.find('select.' + key).val(setting);
                });
            }
        });
    }
}

/**
 * save config to homey
 */
function saveConfig(force_day) {
    var zone_id = $('#zones-list a.enabled').data('id'),
        settings = {
            enabled: $('#toggle_schedule').is(':checked'),
            plan: {}
        },
        plans = config.schedule.hasOwnProperty(zone_id) ? config.schedule[zone_id].plan : default_plan,
        daytimes = {};

    $('#plan tbody tr').each(function () {
        var daytime = $(this).attr('id');
        daytimes[daytime] = {};
    });

    $('#days a').each(function () {
        var day = $(this).data('day');

        settings.plan[day] = plans.hasOwnProperty(day) && !isEmptyObject(plans[day]) ? plans[day] : default_plan;

        if (
            (!force_day && $(this).hasClass('enabled'))
            || (force_day && force_day == day)
        ) {
            var plan = {};

            $('#plan tbody tr').each(function () {
                var daytime = $(this).attr('id');
                plan[daytime] = {};

                $(this).find('select').each(function () {
                    var element = $(this).attr('class');
                    plan[daytime][element] = $(this).val();
                });
            });

            settings.plan[day] = plan;
        }
    });

    // remove from last triggered devices, if disabled
    if (!settings.enabled && data.zone2devices.hasOwnProperty(zone_id)) {
        data.zone2devices[zone_id].forEach(function (device_id) {
            if (config.hasOwnProperty('lastTriggeredTemperature') && config.lastTriggeredTemperature.hasOwnProperty(device_id)) {
                delete config.lastTriggeredTemperature[device_id];
            }
        });
    }

    config.schedule[zone_id] = settings;
    config.updated = new Date().getTime();

    Homey.set('config', config);
}

/**
 * copys a schedule to another day
 */
function copyConfig(to_day) {
    if (!$('#copy li.' + to_day).hasClass('disabled')) {
        if ($('#copy li.' + to_day).hasClass('copied')) {
            $('#copy li.' + to_day).find('em').fadeOut(100, function () {
                $(this).fadeIn(100);
            });
        }
        else {
            $('#copy li.' + to_day).addClass('copied');
        }

        saveConfig(to_day);
    }
}

/**
 * set default data
 */
function setDefaults() {
    $('#toggle_schedule').attr('checked', false);
    $('#schedule').addClass('disabled');
    $('#schedule select').attr('disabled', true);

    $('#morning').find('select.hour').val(6);
    $('#morning').find('select.temperature').val(22);


    $('#day').find('select.hour').val(12);
    $('#day').find('select.temperature').val(18);

    $('#evening').find('select.hour').val(18);
    $('#evening').find('select.temperature').val(22);

    $('#night').find('select.hour').val(23);
    $('#night').find('select.temperature').val(18);

    $('#copy li').removeClass('copied').removeClass('disabled');
    $('#copy li:first').next().addClass('disabled');
}

/**
 * Read log
 */
function readLog() {
    $.get('/app/de.codeking.heatingschedule/userdata/main.log', function (log) {
        $('#log-output').html(log);
    });
}

/**
 * DEV Mode
 */
if (document.location.href.indexOf('127.0.0.1') > -1) {
    IS_DEV = true;
    $(document).ready(function () {
        onHomeyReady();
    });
}