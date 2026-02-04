FROM ghcr.io/openfaas/classic-watchdog:0.3.6 AS watchdog

FROM rocker/geospatial

COPY --from=watchdog /fwatchdog /usr/bin/fwatchdog
RUN chmod +x /usr/bin/fwatchdog

WORKDIR /home/app/

COPY main.R .

RUN mkdir -p function

# Install R packages first for layer caching
COPY fn-adaptive-sampling/install_packages.R function/
RUN Rscript function/install_packages.R

# Copy the rest of the function code
COPY fn-adaptive-sampling/ function/

ENV fprocess="Rscript main.R"
EXPOSE 8080

HEALTHCHECK --interval=3s CMD [ -e /tmp/.lock ] || exit 1

CMD ["fwatchdog"]
