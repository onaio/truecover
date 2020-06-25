# fn-adaptive-sampling

## Building

To build, you will need to first clone the relevant template. 

`faas template pull https://github.com/disarm-platform/faas-templates.git --overwrite`

You can then use `faas build` to create a local version.

To run the local version, use:

`docker run -it --rm -p 8080:8080 -e read_timeout=900 -e write_timeout=900 -e exec_timeout=910 -e combine_output=false <INSERT IMAGE_REF FROM BUILD COMMAND OUTPUT>`

_Note_: the `IMAGE_REF` required will look something like `disarm/fn-adaptive-sampling:0.2.2`

## SPECS

See [SPECS.md](./SPECS.md) for algorithm specifications.