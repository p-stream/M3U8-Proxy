/**
 * @author Pasithea0
 * @description IPv6 proxy request handling
 */

import axios, { AxiosRequestConfig } from 'axios';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { URL } from 'url';
import { getNextIPFromPool, isIPv6RotationEnabled } from './ipv6pool';

/**
 * Create a custom HTTP agent with a specific local IPv6 address
 */
export function createIPv6Agent(ipv6: string, isHttps: boolean = false): http.Agent | https.Agent {
    const options = {
        keepAlive: true,
        timeout: 30000,
        localAddress: ipv6,
    };

    return isHttps 
        ? new https.Agent(options) 
        : new http.Agent(options);
}

/**
 * Make an HTTP request using a specific IPv6 address
 */
export async function requestWithIPv6(
    url: string, 
    options: AxiosRequestConfig = {}, 
    ipv6?: string
): Promise<any> {
    // Only use IPv6 if rotation is enabled and we have a valid IPv6 address
    if (!isIPv6RotationEnabled() && !ipv6) {
        // Fall back to regular request
        return axios(url, options);
    }

    // Get an IPv6 address if not provided
    const sourceIp = ipv6 || getNextIPFromPool();
    if (!sourceIp) {
        // Fall back to regular request if we couldn't get an IPv6
        return axios(url, options);
    }

    // Parse URL to determine if we need http or https agent
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    
    // Create appropriate agent with the IPv6 address
    const agent = createIPv6Agent(sourceIp, isHttps);
    
    // Make request with the IPv6 address
    try {
        const response = await axios({
            ...options,
            url,
            httpAgent: !isHttps ? agent : undefined,
            httpsAgent: isHttps ? agent : undefined,
        });
        
        return response;
    } catch (error: any) {
        if (error.code === 'EADDRNOTAVAIL' || error.code === 'ENETUNREACH') {
            // If there's an issue with the IP, try again with a regular request
            console.error(`IPv6 address ${sourceIp} failed, falling back to default IP`);
            return axios(url, options);
        }
        throw error;
    }
}

/**
 * Create a proxied HTTP request using IPv6
 * Used mainly for proxy TS files that require streaming
 */
export function createIPv6StreamRequest(
    method: string,
    url: string,
    headers: any = {},
    callback: (response: http.IncomingMessage) => void,
    ipv6?: string
): http.ClientRequest {
    // Parse URL
    const uri = new URL(url);
    const isHttps = uri.protocol === 'https:';
    
    // Get IPv6 address if not provided and if rotation is enabled
    const sourceIp = ipv6 || (isIPv6RotationEnabled() ? getNextIPFromPool() : null);
    
    // Request options
    const options: http.RequestOptions = {
        hostname: uri.hostname,
        port: uri.port || (isHttps ? 443 : 80),
        path: uri.pathname + uri.search,
        method: method,
        headers: headers,
    };
    
    // Add localAddress if we have an IPv6
    if (sourceIp) {
        options.localAddress = sourceIp;
        if (isIPv6RotationEnabled()) {
            console.log(`Using IPv6: ${sourceIp} for request to ${url}`);
        }
    }
    
    // Create the request
    const requestFn = isHttps ? https.request : http.request;
    const req = requestFn(options, callback);
    
    // Handle errors
    req.on('error', (err) => {
        console.error(`Error with ${sourceIp ? 'IPv6 ' + sourceIp : 'default IP'} request:`, err.message);
    });
    
    return req;
} 