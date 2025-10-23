from flask import Blueprint, request, jsonify
import requests
import os
import json
from auth.middleware import require_auth

functions_bp = Blueprint('functions', __name__)

# Docker function URLs from environment
PREVALENCE_URL = os.getenv('DOCKER_FN_PREVALENCE_URL', 'http://localhost:8081')
COVARIATE_URL = os.getenv('DOCKER_FN_COVARIATE_URL', 'http://localhost:8082')
SAMPLING_URL = os.getenv('DOCKER_FN_SAMPLING_URL', 'http://localhost:8083')

def parse_json_response(response):
    """
    Parse JSON from response, handling cases where extra data follows the JSON.
    Uses JSONDecoder to extract the first valid JSON object and ignores trailing data.
    """
    try:
        # First try the standard method
        return response.json()
    except (ValueError, json.JSONDecodeError) as e:
        # If that fails, try to extract just the first valid JSON object
        text = response.text
        decoder = json.JSONDecoder()
        obj, idx = decoder.raw_decode(text)

        # Log if there was extra data
        if idx < len(text):
            extra_data = text[idx:idx+200]
            print(f"Warning: Extra data after JSON (showing first 200 chars): {extra_data}")

        return obj

@functions_bp.route('/api/sampling', methods=['POST'])
@require_auth
def adaptive_sampling(user):
    """
    Proxy authenticated requests to the adaptive sampling Docker function
    """
    try:
        # Get request data
        data = request.get_json()

        # Forward request to Docker function
        response = requests.post(
            SAMPLING_URL,
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=120  # 2 minute timeout
        )

        # Try to parse JSON response, handling extra data after JSON
        try:
            json_data = parse_json_response(response)
            return jsonify(json_data), response.status_code
        except (ValueError, json.JSONDecodeError) as json_error:
            # If JSON parsing fails, return the raw response text in an error
            print(f"JSON parsing error from sampling function: {json_error}")
            print(f"Raw response (first 1000 chars): {response.text[:1000]}")
            return jsonify({
                'error': 'Invalid JSON response from sampling function',
                'details': str(json_error),
                'raw_response_preview': response.text[:500]
            }), 500

    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request to sampling function timed out'}), 504
    except requests.exceptions.RequestException as e:
        print(f"Error calling sampling function: {e}")
        return jsonify({'error': 'Failed to call sampling function', 'details': str(e)}), 500
    except Exception as e:
        print(f"Unexpected error in sampling proxy: {e}")
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500


@functions_bp.route('/api/prediction', methods=['POST'])
@require_auth
def prevalence_prediction(user):
    """
    Proxy authenticated requests to the prevalence predictor Docker function
    """
    try:
        # Get request data
        data = request.get_json()

        # Forward request to Docker function
        # Note: The prevalence predictor has a longer timeout (910 seconds max)
        response = requests.post(
            PREVALENCE_URL,
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=920  # Slightly longer than the function's exec_timeout
        )

        # Try to parse JSON response, handling extra data after JSON
        try:
            json_data = parse_json_response(response)
            return jsonify(json_data), response.status_code
        except (ValueError, json.JSONDecodeError) as json_error:
            # If JSON parsing fails, return the raw response text in an error
            print(f"JSON parsing error from prediction function: {json_error}")
            print(f"Raw response (first 1000 chars): {response.text[:1000]}")
            return jsonify({
                'error': 'Invalid JSON response from prediction function',
                'details': str(json_error),
                'raw_response_preview': response.text[:500]
            }), 500

    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request to prediction function timed out'}), 504
    except requests.exceptions.RequestException as e:
        print(f"Error calling prediction function: {e}")
        return jsonify({'error': 'Failed to call prediction function', 'details': str(e)}), 500
    except Exception as e:
        print(f"Unexpected error in prediction proxy: {e}")
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500


@functions_bp.route('/api/covariate', methods=['POST'])
@require_auth
def covariate_extraction(user):
    """
    Proxy authenticated requests to the covariate extractor Docker function
    """
    try:
        # Get request data
        data = request.get_json()

        # Forward request to Docker function
        response = requests.post(
            COVARIATE_URL,
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=620  # Slightly longer than the function's exec_timeout (600s)
        )

        # Try to parse JSON response, handling extra data after JSON
        try:
            json_data = parse_json_response(response)
            return jsonify(json_data), response.status_code
        except (ValueError, json.JSONDecodeError) as json_error:
            # If JSON parsing fails, return the raw response text in an error
            print(f"JSON parsing error from covariate function: {json_error}")
            print(f"Raw response (first 1000 chars): {response.text[:1000]}")
            return jsonify({
                'error': 'Invalid JSON response from covariate function',
                'details': str(json_error),
                'raw_response_preview': response.text[:500]
            }), 500

    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request to covariate function timed out'}), 504
    except requests.exceptions.RequestException as e:
        print(f"Error calling covariate function: {e}")
        return jsonify({'error': 'Failed to call covariate function', 'details': str(e)}), 500
    except Exception as e:
        print(f"Unexpected error in covariate proxy: {e}")
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500
