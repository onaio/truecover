FROM ghcr.io/openfaas/classic-watchdog:0.3.4 as watchdog

FROM disarm/geopandas-r-base

# Allows you to add additional packages via build-arg
# ARG ADDITIONAL_PACKAGE

COPY --from=watchdog /fwatchdog /usr/bin/fwatchdog
RUN chmod +x /usr/bin/fwatchdog
# RUN apk --no-cache add ca-certificates ${ADDITIONAL_PACKAGE}


# Add non root user
# RUN addgroup -S app && adduser app -S -G app

WORKDIR /home/app/

COPY index.py           .
COPY requirements.txt   .
COPY tempdir.py        .

# RUN chown -R app /home/app && \
#   mkdir -p /home/app/python && chown -R app /home/app
# USER app
ENV PATH=$PATH:/home/app/.local/bin:/home/app/python/bin/
ENV PYTHONPATH=$PYTHONPATH:/home/app/python

RUN pip install -r requirements.txt --target=/home/app/python

RUN mkdir -p function
RUN touch ./function/__init__.py

WORKDIR /home/app/function/
COPY function/requirements.txt	.

# Install packages - geopandas and pandas should already be in base image
# Install cffi first, then rpy2 for R integration
RUN pip install cffi --target=/home/app/python && \
    pip install 'rpy2>=3.4,<3.5' --target=/home/app/python && \
    pip install --no-deps git+https://github.com/disarm-platform/disarm-gears.git@v0.2.6 --target=/home/app/python && \
    pip install numpy scikit-learn matplotlib pygam descartes requests --no-deps --target=/home/app/python && \
    pip install scipy joblib threadpoolctl future progressbar2 python-utils \
                certifi idna 'urllib3<2' charset-normalizer \
                pyparsing pillow kiwisolver fonttools cycler packaging typing-extensions \
                six python-dateutil pytz tzlocal jinja2 \
                --target=/home/app/python

WORKDIR /home/app/

# USER root

COPY function           function

# RUN chown -R app:app ./ && \
#   chmod -R 777 /home/app/python

# USER app

ENV fprocess="python3 index.py"
EXPOSE 8080

HEALTHCHECK --interval=3s CMD [ -e /tmp/.lock ] || exit 1

CMD ["fwatchdog"]
