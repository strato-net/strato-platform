class HealthMonitor {
    private lastError = '';

    recordFailure(error: string): void {
        this.lastError = error;
    }

    isHealthy(): boolean {
        return !this.lastError;
    }

    getStatus(): any {
        return {
            status: this.isHealthy() ? 'healthy' : 'unhealthy',
            lastError: this.lastError
        };
    }
}

export const healthMonitor = new HealthMonitor();
