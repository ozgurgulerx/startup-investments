"""
Health Monitor Azure Function

Checks if backend services are running and can start them if stopped.
Called by frontend when it detects backend is unavailable.

Endpoints:
  GET /api/health-check - Check status of all services
  POST /api/wake-up - Start stopped services
"""

import logging
import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.mgmt.containerservice import ContainerServiceClient
from azure.mgmt.rdbms.postgresql_flexibleservers import PostgreSQLManagementClient
import os
import json

# Configuration
SUBSCRIPTION_ID = os.environ.get('AZURE_SUBSCRIPTION_ID')
AKS_RESOURCE_GROUP = 'aistartuptr'
AKS_CLUSTER_NAME = 'aks-aistartuptr'
POSTGRES_RESOURCE_GROUP = 'aistartupstr'
POSTGRES_SERVER_NAME = 'aistartupstr'

app = func.FunctionApp()

def get_credentials():
    """Get Azure credentials."""
    return DefaultAzureCredential()


def check_aks_status(credential) -> dict:
    """Check AKS cluster status."""
    try:
        client = ContainerServiceClient(credential, SUBSCRIPTION_ID)
        cluster = client.managed_clusters.get(AKS_RESOURCE_GROUP, AKS_CLUSTER_NAME)
        return {
            'service': 'aks',
            'name': AKS_CLUSTER_NAME,
            'status': cluster.power_state.code if cluster.power_state else 'Unknown',
            'running': cluster.power_state.code == 'Running' if cluster.power_state else False
        }
    except Exception as e:
        logging.error(f"Error checking AKS: {e}")
        return {
            'service': 'aks',
            'name': AKS_CLUSTER_NAME,
            'status': 'Error',
            'running': False,
            'error': str(e)
        }


def check_postgres_status(credential) -> dict:
    """Check PostgreSQL server status."""
    try:
        client = PostgreSQLManagementClient(credential, SUBSCRIPTION_ID)
        server = client.servers.get(POSTGRES_RESOURCE_GROUP, POSTGRES_SERVER_NAME)
        return {
            'service': 'postgres',
            'name': POSTGRES_SERVER_NAME,
            'status': server.state,
            'running': server.state == 'Ready'
        }
    except Exception as e:
        logging.error(f"Error checking PostgreSQL: {e}")
        return {
            'service': 'postgres',
            'name': POSTGRES_SERVER_NAME,
            'status': 'Error',
            'running': False,
            'error': str(e)
        }


def start_aks(credential) -> dict:
    """Start AKS cluster if stopped."""
    try:
        client = ContainerServiceClient(credential, SUBSCRIPTION_ID)
        cluster = client.managed_clusters.get(AKS_RESOURCE_GROUP, AKS_CLUSTER_NAME)

        if cluster.power_state and cluster.power_state.code == 'Stopped':
            logging.info(f"Starting AKS cluster {AKS_CLUSTER_NAME}...")
            client.managed_clusters.begin_start(AKS_RESOURCE_GROUP, AKS_CLUSTER_NAME)
            return {
                'service': 'aks',
                'action': 'started',
                'message': 'AKS cluster start initiated. May take 2-5 minutes.'
            }
        else:
            return {
                'service': 'aks',
                'action': 'none',
                'message': f'AKS cluster is already {cluster.power_state.code if cluster.power_state else "unknown"}'
            }
    except Exception as e:
        logging.error(f"Error starting AKS: {e}")
        return {
            'service': 'aks',
            'action': 'error',
            'message': str(e)
        }


def start_postgres(credential) -> dict:
    """Start PostgreSQL server if stopped."""
    try:
        client = PostgreSQLManagementClient(credential, SUBSCRIPTION_ID)
        server = client.servers.get(POSTGRES_RESOURCE_GROUP, POSTGRES_SERVER_NAME)

        if server.state == 'Stopped':
            logging.info(f"Starting PostgreSQL server {POSTGRES_SERVER_NAME}...")
            client.servers.begin_start(POSTGRES_RESOURCE_GROUP, POSTGRES_SERVER_NAME)
            return {
                'service': 'postgres',
                'action': 'started',
                'message': 'PostgreSQL server start initiated. May take 1-3 minutes.'
            }
        else:
            return {
                'service': 'postgres',
                'action': 'none',
                'message': f'PostgreSQL server is already {server.state}'
            }
    except Exception as e:
        logging.error(f"Error starting PostgreSQL: {e}")
        return {
            'service': 'postgres',
            'action': 'error',
            'message': str(e)
        }


@app.function_name(name="health_check")
@app.route(route="health-check", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health_check(req: func.HttpRequest) -> func.HttpResponse:
    """
    Check health status of all backend services.

    Returns:
        JSON with status of AKS and PostgreSQL
    """
    logging.info('Health check requested')

    try:
        credential = get_credentials()

        aks_status = check_aks_status(credential)
        postgres_status = check_postgres_status(credential)

        all_running = aks_status['running'] and postgres_status['running']

        result = {
            'healthy': all_running,
            'services': [aks_status, postgres_status],
            'message': 'All services running' if all_running else 'Some services are stopped'
        }

        return func.HttpResponse(
            json.dumps(result),
            mimetype="application/json",
            status_code=200 if all_running else 503
        )
    except Exception as e:
        logging.error(f"Health check error: {e}")
        return func.HttpResponse(
            json.dumps({'error': str(e), 'healthy': False}),
            mimetype="application/json",
            status_code=500
        )


@app.function_name(name="wake_up")
@app.route(route="wake-up", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def wake_up(req: func.HttpRequest) -> func.HttpResponse:
    """
    Start any stopped backend services.

    Returns:
        JSON with actions taken for each service
    """
    logging.info('Wake up requested')

    try:
        credential = get_credentials()

        results = []

        # Start PostgreSQL first (AKS needs it)
        postgres_result = start_postgres(credential)
        results.append(postgres_result)

        # Start AKS
        aks_result = start_aks(credential)
        results.append(aks_result)

        any_started = any(r['action'] == 'started' for r in results)

        return func.HttpResponse(
            json.dumps({
                'actions': results,
                'started': any_started,
                'message': 'Services are starting up. Check again in 2-5 minutes.' if any_started else 'All services already running.'
            }),
            mimetype="application/json",
            status_code=202 if any_started else 200
        )
    except Exception as e:
        logging.error(f"Wake up error: {e}")
        return func.HttpResponse(
            json.dumps({'error': str(e)}),
            mimetype="application/json",
            status_code=500
        )
