"use strict";

module.exports = function ($scope, dizquetv) {
    $scope.channels = [];
    $scope.showChannelConfig = false;
    $scope.selectedChannel = null;
    $scope.selectedChannelIndex = -1;

    $scope.refreshChannels = async () => {
        $scope.channels = [{ number: 1, pending: true }];
        const channelNumbers = await dizquetv.getChannelNumbers();
        $scope.channels = channelNumbers.map((x) => ({
            number: x,
            pending: true,
        }));
        $scope.$apply();
        $scope.queryChannels();
    };
    $scope.refreshChannels();

    $scope.queryChannels = () => {
        for (let i = 0; i < $scope.channels.length; i++) {
            $scope.queryChannel(i, $scope.channels[i]);
        }
    };

    $scope.queryChannel = async (index, channel) => {
        const ch = await dizquetv.getChannelDescription(channel.number);
        ch.pending = false;
        $scope.channels[index] = ch;
        $scope.$apply();
    };

    $scope.removeChannel = async ($index, channel) => {
        if (confirm("Are you sure to delete channel: " + channel.name + "?")) {
            $scope.channels[$index].pending = true;
            await dizquetv.removeChannel(channel);
            $scope.refreshChannels();
        }
    };
    $scope.onChannelConfigDone = async (channel) => {
        if ($scope.selectedChannelIndex != -1) {
            $scope.channels[$scope.selectedChannelIndex].pending = false;
        }
        if (typeof channel !== "undefined") {
            if ($scope.selectedChannelIndex == -1) {
                // add new channel
                await dizquetv.addChannel(channel);
                $scope.showChannelConfig = false;
                $scope.refreshChannels();
            } else if (
                typeof $scope.originalChannelNumber !== "undefined" &&
                $scope.originalChannelNumber != channel.number
            ) {
                //update + change channel number.
                $scope.channels[$scope.selectedChannelIndex].pending = true;
                await dizquetv.updateChannel(channel),
                    await dizquetv.removeChannel({ number: $scope.originalChannelNumber });
                $scope.showChannelConfig = false;
                $scope.$apply();
                $scope.refreshChannels();
            } else {
                // update existing channel
                $scope.channels[$scope.selectedChannelIndex].pending = true;
                await dizquetv.updateChannel(channel);
                $scope.showChannelConfig = false;
                $scope.$apply();
                $scope.refreshChannels();
            }
        } else {
            $scope.showChannelConfig = false;
        }
    };
    $scope.selectChannel = async (index) => {
        if (index === -1 || $scope.channels[index].pending) {
            $scope.originalChannelNumber = undefined;
            $scope.selectedChannel = null;
            $scope.selectedChannelIndex = -1;
            $scope.showChannelConfig = true;
        } else {
            $scope.channels[index].pending = true;
            const p = await Promise.all([
                dizquetv.getChannelProgramless($scope.channels[index].number),
                dizquetv.getChannelPrograms($scope.channels[index].number),
            ]);
            const ch = p[0];
            ch.programs = p[1];
            const newObj = ch;
            newObj.startTime = new Date(newObj.startTime);
            $scope.originalChannelNumber = newObj.number;
            $scope.selectedChannel = newObj;
            $scope.selectedChannelIndex = index;
            $scope.showChannelConfig = true;
            $scope.$apply();
        }
    };
};
