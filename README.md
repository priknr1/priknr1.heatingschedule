# Heating Schedule for Homey
With this app you can control your thermostats and schedule several timings.<br />
After installation, it shows a scheduling mask for each zone with attached thermostats.<br />
<br />
For every zone you can enable the heating schedule, if one zone isn't enabled, it automatically inherits the schedule from the parent zone (if enabled).
<br />
For basic usage you don't need any flows, it works standalone once the schedule for a zone was enabled.
<br />
If you like this app:

<a href="https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=BZGYJY5M8KZ7N" target="_blank"><img src="https://www.paypal.com/en_US/i/btn/btn_donate_LG.gif" border="0" /></a>

# Cards
**Trigger**
* Thermostat triggered
    * when a schedule triggers an thermostat
* Thermostat updated
    * when a schededule finally updated the temperature (within the wakeup interval)
    
**Condition**
* scheduler is enabled / disabled
* current zone's temperature is greater / less than

**Action**
* enable / disable the heating schedule (e.g. for holidays, no members at home)
* update temperature of a zone (e.g. for leaving home, set temperature to 17°)
* trigger last schedule for a zone (e.g. for coming home, set temperatures to last scheduled settings)

# ToDo
* option to pre-configure schedule for next weeks / months (e.g. for irregular working hours)

# Changelog
* 1.0.0
    * initial stable release
    * verify bearer token after saving
    * logging output added to app settings
    * nest thermostat is working
    * condition card: current zone's temperature is greater / less than (if available by device, the measured temperature will used, otherwise the target temperature)
* 0.0.3
    * many bugfixes and improvements
    * heatlink thermostat is working
    * action card: update zone's temperature
    * action card: trigger latest schedule for a zone
    * condition card: is schedule enabled / disabled
* 0.0.2
    * small bugfixes
    * dutch language added (big thanks to DieterKoblenz!)
* 0.0.1 - initial beta release

## Screenshots
![alt text](https://raw.githubusercontent.com/CodeKingLabs/de.codeking.heatingschedule/master/assets/examples/settings.jpg "Settings")

![alt text](https://raw.githubusercontent.com/CodeKingLabs/de.codeking.heatingschedule/master/assets/examples/flow1.jpg "Flow 1")

![alt text](https://raw.githubusercontent.com/CodeKingLabs/de.codeking.heatingschedule/master/assets/examples/flow2.jpg "Flow 2")

![alt text](https://raw.githubusercontent.com/CodeKingLabs/de.codeking.heatingschedule/master/assets/examples/flow3.jpg "Flow 3")