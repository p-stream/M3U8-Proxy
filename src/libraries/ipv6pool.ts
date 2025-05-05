/**
 * @author Pasithea0
 * @description IPv6 address pool management for rotation
 */

import * as net from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

// Configuration
const DEFAULT_POOL_SIZE = 20;
const DEFAULT_IPV6_PREFIX = ""; // Should be set in environment or config
const DEFAULT_IPV6_SUBNET = ""; // Should be set in environment or config

// Get configuration from environment variables with defaults
export const config = {
    ipv6Prefix: process.env.IPV6_PREFIX || DEFAULT_IPV6_PREFIX,
    ipv6Subnet: process.env.IPV6_SUBNET || DEFAULT_IPV6_SUBNET,
    interface: process.env.IPV6_INTERFACE || detectInterface(),
    desiredPoolSize: parseInt(process.env.IPV6_POOL_SIZE || DEFAULT_POOL_SIZE.toString()),
    poolManageInterval: parseInt(process.env.IPV6_POOL_INTERVAL || '5000'),
    poolAddBatchSize: parseInt(process.env.IPV6_BATCH_SIZE || '5'),
    debug: process.env.IPV6_DEBUG === 'true',
};

// Pool state
let ipPool: string[] = [];
let poolMutex = false;
let currentIPIndex = 0;
let initialized = false;
let poolTimer: NodeJS.Timeout | null = null;

/**
 * Detects the primary network interface
 */
function detectInterface(): string {
    const interfaces = os.networkInterfaces();
    // Find first non-internal interface
    for (const [name, netInterfaces] of Object.entries(interfaces)) {
        if (netInterfaces) {
            const ipv4Interface = netInterfaces.find(iface => !iface.internal && iface.family === 'IPv4');
            if (ipv4Interface) {
                return name;
            }
        }
    }
    return 'eth0'; // Default fallback
}

/**
 * Generates a random IPv6 address using the configured prefix
 */
export function randomIPv6(): string {
    const hostPart1 = Math.floor(Math.random() * 0xFFFFFFFF);
    const hostPart2 = Math.floor(Math.random() * 0xFFFFFFFF);

    return `${config.ipv6Prefix}:${config.ipv6Subnet}:${(hostPart1 >> 16 & 0xFFFF).toString(16).padStart(4, '0')}:${(hostPart1 & 0xFFFF).toString(16).padStart(4, '0')}:${(hostPart2 >> 16 & 0xFFFF).toString(16).padStart(4, '0')}:${(hostPart2 & 0xFFFF).toString(16).padStart(4, '0')}`;
}

/**
 * Checks if the interface exists and is up
 */
export async function checkInterface(): Promise<boolean> {
    try {
        if (process.platform === 'darwin' || process.platform === 'win32') {
            // MacOS or Windows - just check if interface exists
            const interfaces = os.networkInterfaces();
            return !!interfaces[config.interface];
        } else {
            // Linux - use ip link command
            const { stdout } = await execAsync(`ip link show ${config.interface}`);
            return stdout.includes('state UP') || stdout.includes('LOWER_UP');
        }
    } catch (err) {
        console.error(`Error checking interface ${config.interface}:`, err);
        return false;
    }
}

/**
 * Adds an IPv6 address to the interface
 */
export async function addIPv6ToInterface(ipv6: string): Promise<boolean> {
    try {
        let cmd;
        if (process.platform === 'darwin') {
            // MacOS
            cmd = `sudo ifconfig ${config.interface} inet6 ${ipv6}/128 alias`;
        } else if (process.platform === 'win32') {
            // Windows
            cmd = `netsh interface ipv6 add address "${config.interface}" ${ipv6}/128`;
        } else {
            // Linux
            cmd = `ip -6 addr add ${ipv6}/128 dev ${config.interface}`;
        }
        
        await execAsync(cmd);
        if (config.debug) {
            console.log(`Added IPv6 address ${ipv6} to ${config.interface}`);
        }
        return true;
    } catch (err: any) {
        // If error contains "File exists", the address is already added
        if (err.message && err.message.includes("File exists")) {
            if (config.debug) {
                console.log(`IPv6 address ${ipv6} already exists on ${config.interface}`);
            }
            return true;
        }
        if (config.debug) {
            console.error(`Failed to add IPv6 address ${ipv6} to ${config.interface}:`, err);
        }
        return false;
    }
}

/**
 * Removes an IPv6 address from the interface
 */
export async function removeIPv6FromInterface(ipv6: string): Promise<boolean> {
    try {
        let cmd;
        if (process.platform === 'darwin') {
            // MacOS
            cmd = `sudo ifconfig ${config.interface} inet6 ${ipv6}/128 -alias`;
        } else if (process.platform === 'win32') {
            // Windows
            cmd = `netsh interface ipv6 delete address "${config.interface}" ${ipv6}`;
        } else {
            // Linux
            cmd = `ip -6 addr del ${ipv6}/128 dev ${config.interface}`;
        }
        
        await execAsync(cmd);
        if (config.debug) {
            console.log(`Removed IPv6 address ${ipv6} from ${config.interface}`);
        }
        return true;
    } catch (err) {
        if (config.debug) {
            console.error(`Failed to remove IPv6 address ${ipv6} from ${config.interface}:`, err);
        }
        return false;
    }
}

/**
 * Gets the next IPv6 address from the pool in a round-robin fashion
 */
export function getNextIPFromPool(): string | null {
    if (!initialized || ipPool.length === 0) {
        return null;
    }

    // Simple round-robin selection
    const index = currentIPIndex;
    currentIPIndex = (currentIPIndex + 1) % ipPool.length;
    
    const ip = ipPool[index];
    if (net.isIPv6(ip)) {
        return ip;
    }
    
    // If we have an invalid IP, try the next one
    return getNextIPFromPool();
}

/**
 * Manages the IPv6 address pool by adding/removing addresses as needed
 */
async function manageIPPool() {
    if (poolMutex) return;
    poolMutex = true;

    try {
        // Current size and how many to add
        const currentSize = ipPool.length;
        const needToAdd = currentSize < config.desiredPoolSize;
        const batchTarget = Math.min(config.poolAddBatchSize, config.desiredPoolSize - currentSize);
        
        // Should we replace some IPs?
        const shouldReplace = currentSize >= config.desiredPoolSize;
        
        // IPs to remove if needed
        let ipsToRemove: string[] = [];
        
        if (shouldReplace) {
            // Remove oldest IPs (up to batch size)
            const numToRemove = Math.min(config.poolAddBatchSize, currentSize);
            ipsToRemove = ipPool.slice(0, numToRemove);
            ipPool = ipPool.slice(numToRemove);
            
            // Reset index if needed
            if (currentIPIndex >= ipPool.length && ipPool.length > 0) {
                currentIPIndex = 0;
            }
        }
        
        // Remove IPs if needed
        if (ipsToRemove.length > 0) {
            for (const ip of ipsToRemove) {
                await removeIPv6FromInterface(ip);
            }
        }
        
        // Add new IPs if needed
        if (needToAdd && batchTarget > 0) {
            const addedIPs: string[] = [];
            
            for (let i = 0; i < batchTarget; i++) {
                const newIP = randomIPv6();
                const success = await addIPv6ToInterface(newIP);
                if (success) {
                    addedIPs.push(newIP);
                }
            }
            
            if (addedIPs.length > 0) {
                ipPool = [...ipPool, ...addedIPs];
                if (config.debug) {
                    console.log(`Added ${addedIPs.length} IPs to pool. Pool size now: ${ipPool.length}`);
                }
            }
        }
    } finally {
        poolMutex = false;
    }
}

/**
 * Initializes the IPv6 pool
 */
export async function initIPv6Pool(): Promise<boolean> {
    if (initialized) return true;
    
    // Check if IPv6 rotation is configured
    if (!config.ipv6Prefix || !config.ipv6Subnet) {
        console.log("IPv6 rotation not configured. Set IPV6_PREFIX and IPV6_SUBNET environment variables to enable.");
        return false;
    }
    
    // Check interface
    const interfaceOk = await checkInterface();
    if (!interfaceOk) {
        console.error(`Interface ${config.interface} not found or not up.`);
        return false;
    }
    
    // Initialize the pool
    console.log(`Initializing IPv6 pool with size ${config.desiredPoolSize} on interface ${config.interface}`);
    
    // Start the pool manager
    await manageIPPool();
    poolTimer = setInterval(manageIPPool, config.poolManageInterval);
    
    initialized = true;
    return true;
}

/**
 * Stops the IPv6 pool management and cleans up
 */
export async function stopIPv6Pool(): Promise<void> {
    if (!initialized) return;
    
    // Stop the timer
    if (poolTimer) {
        clearInterval(poolTimer);
        poolTimer = null;
    }
    
    // Remove all IPs from the interface
    for (const ip of ipPool) {
        await removeIPv6FromInterface(ip);
    }
    
    // Clear the pool
    ipPool = [];
    currentIPIndex = 0;
    initialized = false;
}

/**
 * Check if IPv6 rotation is enabled and working
 */
export function isIPv6RotationEnabled(): boolean {
    return initialized && ipPool.length > 0;
}

/**
 * Get information about the IPv6 pool
 */
export function getIPv6PoolInfo(): { 
    enabled: boolean; 
    poolSize: number; 
    interface: string;
    prefix: string;
} {
    return {
        enabled: initialized,
        poolSize: ipPool.length,
        interface: config.interface,
        prefix: config.ipv6Prefix,
    };
} 