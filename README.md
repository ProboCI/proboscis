Proboscis
==============
[![Build Status](https://travis-ci.org/ProboCI/proboscis.svg?branch=master)](https://travis-ci.org/ProboCI/proboscis)
[![Coverage Status](https://coveralls.io/repos/ProboCI/proboscis/badge.png?branch=master)](https://coveralls.io/r/ProboCI/proboscis?branch=master)

This module wraps child processes and unifies their stdout and stderr streams into a signle unified json event stream.  It can currnently be used as a library or from the command line.

This project was created to facilitate running multiple processes inside a docker container easily and being able to easily separate the streams of all of the running processes.

## Why proboscis?

This module was written to be the part of [probo](http://github.com/ProboCI/probo) that runs inside the docker container. The prooboscis is the part of the mosquito that pokes into your skin. We probably could have come up with a less itchy analogy.
