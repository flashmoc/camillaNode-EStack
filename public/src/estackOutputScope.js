// E-Stack input trims live before the routing mixer on capture channels 0/1.
// Output editors also use channel numbers 0/1 for SUB/KICK, so keep those
// pre-mixer trims out of output filter lists and response calculations.
const estackOriginalFilterNamesForOutputScope = filterNames;
filterNames = function(channel = selectedChannel) {
    return estackOriginalFilterNamesForOutputScope(channel).filter(name => !String(name).startsWith("INPUT_TRIM_"));
};
