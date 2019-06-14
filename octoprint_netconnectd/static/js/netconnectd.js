$(function() {
    function NetconnectdViewModel(parameters) {
        var self = this;

        self.loginState = parameters[0];
        self.settingsViewModel = parameters[1];
        
        self.allViewModels = undefined;

        self.isWizardActive = false;

        self.pollingEnabled = false;
        self.pollingTimeoutId = undefined;

        self.reconnectInProgress = false;
        self.reconnectTimeout = undefined;

        self.enableQualitySorting = ko.observable(false);
        
        self.hostname = ko.observable(undefined);
        self.forwardUrl = ko.observable(undefined);
        
        self.status = {
            link: ko.observable(),
            connections: {
                ap: ko.observable(),
                wifi: ko.observable(),
                wired: ko.observable()
            },
            wifi: {
                current_ssid: ko.observable(),
                current_address: ko.observable(),
                present: ko.observable()
            },
            ip_addresses: {
				eth0: ko.observable(),
				wlan0: ko.observable(),
			}
        };
        self.statusCurrentWifi = ko.observable();

        self.editorWifi = undefined;
        self.editorWifiSsid = ko.observable();
        self.editorWifiPassphrase1 = ko.observable();
        self.editorWifiPassphrase2 = ko.observable();
        self.editorWifiPassphraseMismatch = ko.computed(function() {
            return self.editorWifiPassphrase1() != self.editorWifiPassphrase2();
        });
        self.editorWifiPassphraseNotEmpty = ko.computed(function() {
            
            return self.editorWifiPassphrase1() != self.editorWifiPassphrase2();
        });

        self.working = ko.observable(false);
        self.error = ko.observable(false);

        self.connectionStateText = ko.computed(function() {
            var text;

            if (self.error()) {
                text = gettext("Error while talking to netconnectd, is the service running?");
            } else if (self.status.connections.ap()) {
                text = gettext("Acting as access point");
            } else if (self.status.link()) {
                if (self.status.connections.wired()) {
                    text = gettext("Connected via wire");
                } else if (self.status.connections.wifi()) {
                    if (self.status.wifi.current_ssid()) {
                        text = _.sprintf(gettext("Connected via wifi (SSID \"%(ssid)s\")"), {ssid: self.status.wifi.current_ssid()});
                    } else {
                        text = gettext("Connected via wifi (unknown SSID)")
                    }
                } else {
                    text = gettext("Connected (unknown connection)");
                }
            } else {
                text = gettext("Not connected to network");
            }

            if (!self.status.wifi.present()) {
                text += ", " + gettext("no wifi interface present")
            }

            return text;
        });

        self.connectionStateTextEthernet = ko.computed(function() {
            if (self.status.connections.wired()) {
                return gettext('Connected (IP: ') + self.status.ip_addresses.eth0() + ")";
            } else {
                return gettext("Not connected");
            }
        });

        self.connectionStateTextWifi = ko.computed(function() {
            if (self.status.connections.ap()) {
                return gettext("Access point (IP: ") + self.status.ip_addresses.wlan0() + ")";
            } else if (self.status.connections.wifi() && self.status.wifi.current_ssid()) {
                return _.sprintf(gettext("Connected to \"%(ssid)s\" (IP: %(ip)s)"), {ssid: self.status.wifi.current_ssid(), ip: self.status.ip_addresses.wlan0()});
            } else if (self.status.connections.wifi()) {
                return _.sprintf(gettext("Connected to unknown wifi (IP: %(ip)s)"), {ssid: self.status.wifi.current_ssid(), ip: self.status.ip_addresses.wlan0()});
            } else {
                return gettext("Access point down, not connected");
            }
        });

        self.onAllBound = function(allViewModels) {
            self.allViewModels = allViewModels;
        }
        
        self.onWizardDetails = function(response){
            console.log("ANDYETST onWizardDetails() setting self.isWizardActive = true");
            self.isWizardActive = true;
            
            // and load data
            self.requestData();
        };
        
        self.onWizardFinish = function(response){
            console.log("ANDYETST onWizardFinish() setting self.isWizardActive = false");
            self.isWizardActive = false;
        };
        
        self.canRun = function(){
            return (self.isWizardActive || self.loginState.isAdmin());
        };

        self.daemonOnline = ko.computed(function() {
            return (!(self.error()));
        });

        self.apRunning = ko.computed(function() {
            return self.status.connections.ap();
        });

        // initialize list helper
        self.listHelper = new ItemListHelper(
            "wifis",
            {
                "ssid": function (a, b) {
                    // sorts ascending
                    if (a["ssid"].toLocaleLowerCase() < b["ssid"].toLocaleLowerCase()) return -1;
                    if (a["ssid"].toLocaleLowerCase() > b["ssid"].toLocaleLowerCase()) return 1;
                    return 0;
                },
                "quality": function (a, b) {
                    // sorts descending
                    if (a["quality"] > b["quality"]) return -1;
                    if (a["quality"] < b["quality"]) return 1;
                    return 0;
                }
            },
            {},
            "quality",
            [],
            [],
            10
        );

        self.getEntryId = function(data) {
            return "settings_plugin_netconnectd_wifi_" + md5(data.ssid);
        };

        self.refresh = function() {
            self.requestData();
        };

        self.fromResponse = function (response) {
            if (response.error !== undefined) {
                self.error(true);
                return;
            } else {
                self.error(false);
            }

            self.hostname(response.hostname);
            self.forwardUrl(response.forwardUrl ? response.forwardUrl : undefined);

            self.status.link(response.status.link);
            self.status.connections.ap(response.status.connections.ap);
            self.status.connections.wifi(response.status.connections.wifi);
            self.status.connections.wired(response.status.connections.wired);
            self.status.wifi.current_ssid(response.status.wifi.current_ssid);
            self.status.wifi.current_address(response.status.wifi.current_address);
            self.status.wifi.present(response.status.wifi.present);
            self.status.ip_addresses.eth0(response.ip_addresses.eth0);
            self.status.ip_addresses.wlan0(response.ip_addresses.wlan0);

            self.statusCurrentWifi(undefined);
            if (response.status.wifi.current_ssid && response.status.wifi.current_address) {
                _.each(response.wifis, function(wifi) {
                    if (wifi.ssid == response.status.wifi.current_ssid && wifi.address.toLowerCase() == response.status.wifi.current_address.toLowerCase()) {
                        self.statusCurrentWifi(self.getEntryId(wifi));
                    }
                });
            }

            var enableQualitySorting = false;
            _.each(response.wifis, function(wifi) {
                if (wifi.quality != undefined) {
                    enableQualitySorting = true;
                }
            });
            self.enableQualitySorting(enableQualitySorting);

            var wifis = [];
            _.each(response.wifis, function(wifi) {
                var qualityInt = parseInt(wifi.quality);
                var quality = undefined;
                if (!isNaN(qualityInt)) {
                    quality = self._convert_dbm_to_percent(qualityInt);
                }

                wifis.push({
                    ssid: wifi.ssid,
                    address: wifi.address,
                    encrypted: wifi.encrypted,
                    quality: quality,
                    qualityText: (quality != undefined) ? "" + quality + " %" : ""
                });
            });

            self.listHelper.updateItems(wifis);
            if (!enableQualitySorting) {
                self.listHelper.changeSorting("ssid");
            }

            if (self.pollingEnabled) {
                self.pollingTimeoutId = setTimeout(function() {
                    self.requestData();
                }, 30000)
            }
        };

        self.configureWifi = function(data) {
            if (!self.canRun()) return;

            self.editorWifi = data;
            self.editorWifiSsid(data.ssid);
            self.editorWifiPassphrase1(undefined);
            self.editorWifiPassphrase2(undefined);
            if (data.encrypted) {
                $("#settings_plugin_netconnectd_wificonfig").modal("show");
            } else {
                self.confirmWifiConfiguration();
            }
        };
        
        self.confirmWifiConfiguration = function() {
            var self = this;
            
            self.sendWifiConfig(self.editorWifiSsid(), self.editorWifiPassphrase1(),
            // successCallback 
            function() {
                var myWifi = self.editorWifiSsid();
                self.editorWifi = undefined;
                self.editorWifiSsid(undefined);
                self.editorWifiPassphrase1(undefined);
                self.editorWifiPassphrase2(undefined);
                self.working(false);
                $("#settings_plugin_netconnectd_wificonfig").modal("hide");
                if (self.reconnectInProgress) {
                    self.tryReconnect();
                }
                new PNotify({
                    title: gettext("Wifi Connected"),
                    text: _.sprintf(gettext("Mr Beam 2 is now connceted to your wifi '%s'."), myWifi),
                    type: "success"
                });
                // refresh wifi state
                self.refresh();
            },
            // failureCallback
            function() {
                var myWifi = self.editorWifiSsid();
                self.refresh();
                $("#settings_plugin_netconnectd_wificonfig").modal("hide");
                hideOfflineOverlay();
                self.working(false);
                new PNotify({
                    title: gettext("Connection failed"),
                    text: _.sprintf(gettext("Mr Beam 2 could not connect to your wifi '%s'. Did you enter the correct passphrase?"), myWifi),
                    type: "error"
                });
            });
        };

        self.sendStartAp = function() {
            if (!self.canRun()) return;
            self._postCommand("start_ap", {});
        };

        self.sendStopAp = function() {
            if (!self.canRun()) return;
            self._postCommand("stop_ap", {});
        };

        self.sendWifiRefresh = function(force) {
            if (force === undefined) force = false;
            self._postCommand("list_wifi", {force: force}, function(response) {
                self.fromResponse({"wifis": response});
            });
        };
        
        self.sendWifiConfig = function(ssid, psk, successCallback, failureCallback) {
            if (!self.canRun()) return;
            
            // trigger onBeforeWifiConfigure event.
            callViewModels(self.allViewModels, "onBeforeWifiConfigure", 
                function(viewModelCallback){
                    if (viewModelCallback && typeof viewModelCallback === 'function') {
                    var result = viewModelCallback();
                    if (result && result.forwardUrl) {
                        self.forwardUrl(result.forwardUrl);
                    }
                }
            });

            self.working(true);
            if (self.status.connections.ap()) {
                self.reconnectInProgress = true;

                var reconnectText = gettext("OctoPrint is now switching to your configured Wifi connection and therefore shutting down the Access Point. I'm continuously trying to reach it at <strong>%(hostname)s</strong> but it might take a while. If you are not reconnected over the next couple of minutes, please try to reconnect to OctoPrint manually because then I was unable to find it myself.");

                showOfflineOverlay(
                    gettext("Reconnecting..."),
                    _.sprintf(reconnectText, {hostname: self.hostname()}),
                    self.tryReconnect
                );
            }
            self._postCommand("configure_wifi", {ssid: ssid, psk: psk}, successCallback, failureCallback, function() {
                self.working(false);
                // if (self.reconnectInProgress) {
                //     self.tryReconnect();
                // }
            // }, 5000);
            }, 80000);
        };

        self.sendReset = function() {
            if (!self.canRun()) return;

            self._postCommand("reset", {});
        };

        self.sendForgetWifi = function() {
            if (!self.canRun()) return;
            self._postCommand("forget_wifi", {});
        };

        self.tryReconnect = function() {
            var location = undefined;
            if (!self.forwardUrl()) {
                var hostname = self.hostname();
                location = window.location.href
                location = location.replace(location.match("https?\\://([^:@]+(:[^@]+)?@)?([^:/]+)")[3], hostname);
            } else {
                location = self.forwardUrl();
            }

            var pingCallback = function(result) {
                if (!result) {
                    return;
                }

                if (self.reconnectTimeout != undefined) {
                    clearTimeout(self.reconnectTimeout);
                    window.location.href = location;
                }
                hideOfflineOverlay();
                self.reconnectInProgress = false;
            };

            ping(location, pingCallback);
            self.reconnectTimeout = setTimeout(self.tryReconnect, 1000);
        };

        self._postCommand = function (command, data, successCallback, failureCallback, alwaysCallback, timeout) {
            var payload = _.extend(data, {command: command});

            var params = {
                url: self.isWizardActive ? "/plugin/mrbeam/wifi" : API_BASEURL + "plugin/netconnectd",
                type: "POST",
                dataType: "json",
                data: JSON.stringify(payload),
                contentType: "application/json; charset=UTF-8",
                success: function(response) {
                    if (successCallback) successCallback(response);
                },
                error: function() {
                    if (failureCallback) failureCallback();
                },
                complete: function() {
                    if (alwaysCallback) alwaysCallback();
                }
            };

            if (timeout != undefined) {
                params.timeout = timeout;
            }

            $.ajax(params);
        };

        self.requestData = function () {
            if (self.pollingTimeoutId != undefined) {
                clearTimeout(self.pollingTimeoutId);
                self.pollingTimeoutId = undefined;
            }

            $.ajax({
                url: API_BASEURL + "plugin/netconnectd",
                // url: self.isWizardActive ? "/plugin/mrbeam/wifi" : API_BASEURL + "plugin/netconnectd",
                type: "GET",
                dataType: "json",
                success: self.fromResponse
            });
        };

        self.onUserLoggedIn = function(user) {
            if (user.admin) {
                self.requestData();
            }
        };

        self.onBeforeBinding = function() {
            self.settings = self.settingsViewModel.settings;
        };

        self.onSettingsShown = function() {
            self.pollingEnabled = true;
            self.requestData();
        };

        self.onSettingsHidden = function() {
            if (self.pollingTimeoutId != undefined) {
                self.pollingTimeoutId = undefined;
            }
            self.pollingEnabled = false;
        };

        self.onServerDisconnect = function() {
            return !self.reconnectInProgress;
        }

        self._convert_dbm_to_percent = function(dbm) {
            var res = 0;
            var max = -40;
            var min = -90;
            dbm = parseInt(dbm);
            if (dbm > max) {
                res = 100;
            } else if (dbm < min) {
                res = 0;
            } else {
                res = Math.round(10-((dbm*-1 +max) / (max-min)) * 10)*10
            }
            return res;
        }

    }

    // view model class, parameters for constructor, container to bind to
    ADDITIONAL_VIEWMODELS.push([NetconnectdViewModel, ["loginStateViewModel", "settingsViewModel"], "#settings_plugin_netconnectd"]);
});