import json
import sys
import uuid

import numpy as np
import pandas as pd
import geopandas as gp
import requests
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, ConstantKernel as C


def run_function(params: dict):
    """
    Simplified prevalence predictor without R dependencies for testing
    """
    # Set random seed
    np.random.seed(1000)

    layer_names = params.get('layer_names', [])
    exceedance_threshold = params.get('exceedance_threshold', 0.3)
    point_data = params.get('point_data')

    # Make a GeoPandas DataFrame
    gdf = gp.GeoDataFrame.from_features(point_data['features'])
    
    # Generate some sample predictions using scikit-learn
    # Extract coordinates
    coords = np.array([[geom.x, geom.y] for geom in gdf.geometry])
    prevalence_values = gdf['prevalence'].values
    
    # Simple Gaussian Process model
    kernel = C(1.0, (1e-3, 1e3)) * RBF(1.0, (1e-2, 1e2))
    gp_model = GaussianProcessRegressor(kernel=kernel, n_restarts_optimizer=10)
    
    # Fit the model
    gp_model.fit(coords, prevalence_values)
    
    # Create prediction grid
    x_min, x_max = coords[:, 0].min() - 0.01, coords[:, 0].max() + 0.01
    y_min, y_max = coords[:, 1].min() - 0.01, coords[:, 1].max() + 0.01
    
    # Generate prediction points
    n_points = 50
    x_pred = np.linspace(x_min, x_max, n_points)
    y_pred = np.linspace(y_min, y_max, n_points)
    xx, yy = np.meshgrid(x_pred, y_pred)
    pred_coords = np.column_stack([xx.ravel(), yy.ravel()])
    
    # Make predictions
    pred_mean, pred_std = gp_model.predict(pred_coords, return_std=True)
    
    # Calculate exceedance probability
    exceedance_prob = 1 - (pred_mean < exceedance_threshold).astype(float)
    
    # Create result features
    result_features = []
    for i, (coord, mean_val, std_val, exc_prob) in enumerate(
        zip(pred_coords, pred_mean, pred_std, exceedance_prob)
    ):
        feature = {
            "type": "Feature",
            "properties": {
                "id": i,
                "predicted_prevalence": float(mean_val),
                "prediction_uncertainty": float(std_val),
                "exceedance_probability": float(exc_prob)
            },
            "geometry": {
                "type": "Point",
                "coordinates": [float(coord[0]), float(coord[1])]
            }
        }
        result_features.append(feature)
    
    # Return result
    result = {
        "type": "FeatureCollection",
        "features": result_features,
        "metadata": {
            "model": "gaussian_process_sklearn",
            "exceedance_threshold": exceedance_threshold,
            "n_training_points": len(gdf),
            "n_predictions": len(result_features),
            "layer_names": layer_names,
            "status": "success"
        }
    }
    
    return result


def handle(req):
    """OpenFaaS handler function"""
    try:
        # Parse input
        if isinstance(req, str):
            params = json.loads(req)
        else:
            params = req
        
        # Run the function
        result = run_function(params)
        
        # Return JSON response
        return json.dumps(result, indent=2)
        
    except Exception as e:
        error_result = {
            "error": str(e),
            "status": "failed",
            "type": "error"
        }
        return json.dumps(error_result, indent=2)