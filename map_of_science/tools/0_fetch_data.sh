#!/usr/bin/env bash

mkdir -p ./data
wget -O ./data/basic_data.zip https://zenodo.org/records/12628195/files/map_of_science.zip
unzip ./data/basic_data.zip -d ./data
rm ./data/basic_data.zip

echo OK