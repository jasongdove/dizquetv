export default function ($timeout, commonProgramTools) {
    return {
        restrict: "E",
        templateUrl: "templates/show-config.html",
        replace: true,
        scope: {
            linker: "=linker",
            onDone: "=onDone",
        },
        link: function (scope, element, attrs) {
            scope.showTools = false;
            scope.showPlexLibrary = false;
            scope.content = [];
            scope.visible = false;
            scope.error = undefined;

            function refreshContentIndexes() {
                for (let i = 0; i < scope.content.length; i++) {
                    scope.content[i].$index = i;
                }
            }

            scope.contentSplice = (a, b) => {
                scope.content.splice(a, b);
                refreshContentIndexes();
            };

            scope.dropFunction = (dropIndex, program) => {
                const y = program.$index;
                let z = dropIndex + scope.currentStartIndex - 1;
                scope.content.splice(y, 1);
                if (z >= y) {
                    z--;
                }
                scope.content.splice(z, 0, program);
                refreshContentIndexes();
                $timeout();
                return false;
            };
            scope.setUpWatcher = function setupWatchers() {
                this.$watch("vsRepeat.startIndex", function (val) {
                    scope.currentStartIndex = val;
                });
            };

            scope.movedFunction = (index) => {
                console.log("movedFunction(" + index + ")");
            };

            scope.linker((show) => {
                if (typeof show === "undefined") {
                    scope.name = "";
                    scope.content = [];
                    scope.id = undefined;
                    scope.title = "Create Custom Show";
                } else {
                    scope.name = show.name;
                    scope.content = show.content;
                    scope.id = show.id;
                    scope.title = "Edit Custom Show";
                }
                refreshContentIndexes();
                scope.visible = true;
            });

            scope.finished = (cancelled) => {
                if (cancelled) {
                    scope.visible = false;
                    return scope.onDone();
                }
                if (typeof scope.name === "undefined" || scope.name.length == 0) {
                    scope.error = "Please enter a name";
                }
                if (scope.content.length == 0) {
                    scope.error = "Please add at least one clip.";
                }
                if (typeof scope.error !== "undefined") {
                    $timeout(() => {
                        scope.error = undefined;
                    }, 30000);
                    return;
                }
                scope.visible = false;
                scope.onDone({
                    name: scope.name,
                    content: scope.content.map((c) => {
                        delete c.$index;
                        return c;
                    }),
                    id: scope.id,
                });
            };
            scope.showList = () => {
                return !scope.showPlexLibrary;
            };
            scope.sortShows = () => {
                scope.content = commonProgramTools.sortShows(scope.content);
                refreshContentIndexes();
            };
            scope.sortByDate = () => {
                scope.content = commonProgramTools.sortByDate(scope.content);
                refreshContentIndexes();
            };
            scope.shuffleShows = () => {
                scope.content = commonProgramTools.shuffle(scope.content);
                refreshContentIndexes();
            };
            scope.showRemoveAllShow = () => {
                scope.content = [];
                refreshContentIndexes();
            };
            scope.showRemoveDuplicates = () => {
                scope.content = commonProgramTools.removeDuplicates(scope.content);
                refreshContentIndexes();
            };
            scope.getProgramDisplayTitle = (x) => {
                return commonProgramTools.getProgramDisplayTitle(x);
            };

            scope.removeSpecials = () => {
                scope.content = commonProgramTools.removeSpecials(scope.content);
                refreshContentIndexes();
            };
            scope.importPrograms = (selectedPrograms) => {
                for (let i = 0, l = selectedPrograms.length; i < l; i++) {
                    selectedPrograms[i].commercials = [];
                }
                scope.content = scope.content.concat(selectedPrograms);
                refreshContentIndexes();
                scope.showPlexLibrary = false;
            };

            scope.durationString = (duration) => {
                const date = new Date(0);
                date.setSeconds(Math.floor(duration / 1000)); // specify value for SECONDS here
                return date.toISOString().substr(11, 8);
            };

            scope.programSquareStyle = (x) => {
                return commonProgramTools.programSquareStyle(x);
            };
        },
    };
}
