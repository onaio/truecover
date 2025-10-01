# All the packages from the rocker/geospatial image are already included.
# The full list is https://github.com/rocker-org/geospatial
# This includes: sf, sp, rgeos, raster, geojsonio, etc.

# Install mgcv for GAM modeling (should already be in base R)
# Install any additional packages needed
install.packages(c('geojsonio', 'jsonlite', 'mgcv'))
