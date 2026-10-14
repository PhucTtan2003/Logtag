import axiosClient from "./axios";


export interface LogTagWebhookStatus {
    teamId: number;
    enabled: boolean;
    deliveryStatus: string;
    targetUrl: string;
    signingSecretConfigured: boolean;
    subscriptionCount: number;
    consecutiveFailures: number;
    lastAttemptUtc?: string;
    lastSentUtc?: string;
}


export interface LogTagSubscription {
    serialNumber: string;
    model?: string;
    subscriptionStatus: string;
}



const logtagWebhookApi = {


    async getStatus(teamId:number){

     const res = await axiosClient.get(
   `/api/admin/logtag-webhooks/${teamId}/status`
);

        return res.data.data;
    },



    async configureWebhook(
        teamId:number,
        publicBaseUrl:string,
        enabled:boolean
    ){

        const res = await axiosClient.put(
            `/api/admin/logtag-webhooks/${teamId}/configure`,
            {
                publicBaseUrl,
                enabled
            }
        );


        return res.data;
    },



    async getSubscriptions(teamId:number){

        const res = await axiosClient.get(
            `/api/admin/logtag-webhooks/${teamId}/subscriptions`
        );


        return res.data.data as LogTagSubscription[];
    },



    async createSubscription(
        teamId:number,
        serialNumber:string
    ){

        const res = await axiosClient.post(
            `/api/admin/logtag-webhooks/${teamId}/subscriptions`,
            {
                serialNumber
            }
        );


        return res.data;
    },



    async deleteSubscription(
        teamId:number,
        serialNumber:string
    ){

        const res = await axiosClient.delete(
            `/api/admin/logtag-webhooks/${teamId}/subscriptions/${serialNumber}`
        );


        return res.data;
    }

};


export default logtagWebhookApi;