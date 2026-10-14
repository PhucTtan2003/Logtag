import React,
{
    useEffect,
    useState
}
from "react";


import logtagWebhookApi,
{
    LogTagWebhookStatus,
    LogTagSubscription
}
from "../../api/logtagWebhookApi";


import "../../styles/Admin/LogTagWebhookPage.css";



const DEFAULT_TEAM = 16922;



export default function LogTagWebhookPage(){


    const [teamId,setTeamId] =
        useState<number>(DEFAULT_TEAM);


    const [status,setStatus] =
        useState<LogTagWebhookStatus|null>(null);



    const [subscriptions,setSubscriptions] =
        useState<LogTagSubscription[]>([]);



    const [serial,setSerial] =
        useState("");



    const [loading,setLoading] =
        useState(false);



    const loadData = async()=>{

        try{

            setLoading(true);


            const s =
                await logtagWebhookApi.getStatus(teamId);


            setStatus(s);



            const sub =
                await logtagWebhookApi.getSubscriptions(teamId);


            setSubscriptions(sub);


        }
        catch(err){

            console.error(err);

            alert(
                "Không lấy được dữ liệu LogTag webhook"
            );
        }
        finally{

            setLoading(false);
        }

    };




    useEffect(()=>{

        loadData();

    },[teamId]);





    const configure = async () => {

    try {

        setLoading(true);

        await logtagWebhookApi.configureWebhook(
            teamId,
            "https://logtag.smarttechcloud.net",
            true
        );

        alert("Configure webhook thành công");

        await loadData();

    } catch (err: any) {

        console.error(
            "CONFIGURE WEBHOOK ERROR:",
            err.response?.data || err
        );

        alert(
            JSON.stringify(
                err.response?.data || err
            )
        );

    } finally {

        setLoading(false);
    }
};





   const subscribe = async()=>{

    if(!serial)
        return;


    try {

        await logtagWebhookApi.createSubscription(
            teamId,
            serial
        );


        alert("Subscribe thành công");

        setSerial("");

        loadData();

    }
    catch(err:any){

        console.error(
            "SUBSCRIBE ERROR:",
            err.response?.data || err
        );


        alert(
            JSON.stringify(
                err.response?.data || err
            )
        );
    }

};

    const removeSubscription =
        async(serialNumber:string)=>{


            if(
                !window.confirm(
                    `Remove ${serialNumber}?`
                )
            )
                return;



            await logtagWebhookApi.deleteSubscription(
                teamId,
                serialNumber
            );


            loadData();

        };






return (

<div className="logtag-webhook-page">


<h1>
    LogTag Webhook Management
</h1>



<div className="webhook-card">


<div className="card-header">

<h2>
Webhook Status
</h2>


<button
onClick={configure}
>
Configure
</button>


</div>



{
status &&

<div className="status-grid">


<div>
<label>Status</label>

<span
className={
status.enabled
?"badge success"
:"badge danger"
}
>
{
status.enabled
?"Enabled"
:"Disabled"
}
</span>

</div>



<div>
<label>Delivery</label>

<p>
{status.deliveryStatus}
</p>

</div>



<div>

<label>
Subscriptions
</label>

<p>
{status.subscriptionCount}
devices
</p>

</div>



<div>

<label>
Target URL
</label>

<p className="url">
{status.targetUrl}
</p>

</div>



</div>

}


</div>





<div className="webhook-card">


<h2>
Device Subscription
</h2>



<div className="subscribe-box">


<input

value={serial}

onChange={
e=>setSerial(e.target.value)
}

placeholder="A0A100544830"

/>



<button
onClick={subscribe}
>
Subscribe
</button>


</div>





<table>


<thead>

<tr>

<th>
Serial
</th>

<th>
Status
</th>

<th>
Action
</th>


</tr>


</thead>



<tbody>


{
subscriptions.map(item=>(


<tr key={item.serialNumber}>


<td>
{item.serialNumber}
</td>


<td>

<span className="badge success">

{item.subscriptionStatus}

</span>

</td>


<td>

<button
className="danger-btn"
onClick={()=>
removeSubscription(
item.serialNumber
)
}
>
Remove
</button>


</td>



</tr>


))
}


</tbody>



</table>



</div>





</div>

);


}