/* Hypermedia workflow. 
 ** API over redis-backed workflow instance
 ** Author: Bartosz Balis (2013)
 ** TODO: add functions to create a new workflow instance (createInstance, addTask, ...)
 */
var fs = require('fs'),
    redis = require('redis'),
    async = require('async'),
    rcl = redis.createClient();

rcl.on("error", function (err) {
    console.log("Redis error: " + err);
});


exports.init = function() {
    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// public functions ///////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    // TODO: currently workflow template is not stored in redis. Pegasus-specific
    // getTemplate is implemented in Pegasus dax workflow factory.
    function public_getWfTemplate(wfname, cb) {

    }

    // returns a list of tasks with ids within [from..to], and their ins and outs
    function public_getWfTasks(wfId, from, to, cb) {
	rcl.zcard("wf:"+wfId+":data", function(err, ret) {
		var dataNum = ret;
		if (to < 0) {
			rcl.zcard("wf:"+wfId+":tasks", function(err, ret) {
				if (err) {
					console.log("Error zcard: "+err);
				}
				var to1 = ret+to+1;
				//console.log("From: "+from+", to: "+to1);
				getTasks1(wfId, from, to1, dataNum, cb);
			});
		}  else {
			getTasks1(wfId, from, to, dataNum, cb);
		}
	});
    }

    // returns list of URIs of instances, ...
    function public_getWfInfo(wfName, cb) {
    }

    // returns instance URI, number of tasks, number of data elements, ...
    function public_getWfInstanceInfo(wfId, cb) {
	var multi = rcl.multi();
        multi.zcard("wf:"+wfId+":tasks", function(err, ret) { });
        multi.zcard("wf:"+wfId+":data", function(err, ret) { });
	multi.hgetall("wf:"+wfId, function(err, ret) { });
        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		replies[2].nTasks = replies[0];
		replies[2].nData = replies[1];
                cb(null, replies[2]);
            }
        });
    }

    // returns full task info
    function public_getTaskInfo(wfId, taskId, cb) {
	var taskKey = "wf:"+wfId+":task:"+taskId;
	var task, ins, outs, data = {};

	var multi = rcl.multi();

	// Retrieve task info
	multi.hgetall(taskKey, function(err, reply) {
	    if (err) {
		task = err;
	    } else {
		task = reply;
	    }
	});

	// Retrieve all ids of inputs of the task
	multi.sort(taskKey+":ins", function(err, reply) {
	    if (err) {
		ins = err;
	    } else {
		ins = reply;
	    }
	});

	// Retrieve all ids of outputs of the task
	multi.sort(taskKey+":outs", function(err, reply) {
	    if (err) {
		outs = err;
	    } else {
		outs = reply;
	    }
	});

        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		for (var i=0; i<ins.length; ++i) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+ins[i];
			multi.hmget(dataKey, "uri", "name", "status", function(err, reply) {
			    if (err) {
				data[ins[i]] = err;
			    } else {
				data[ins[i]] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
			    }
			});
		    })(i);
		}
		for (var i=0; i<outs.length; ++i) {
		    (function(i) {
			var dataKey = "wf:"+wfId+":data:"+outs[i];
			multi.hmget(dataKey, "uri", "name", "status", function(err, reply) {
			    if (err) {
				data[outs[i]] = err;
			    } else {
				data[outs[i]] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
			    }
			});
		    })(i);
		}

		multi.exec(function(err, replies) {
		    if (err) {
			console.log(err);
			cb(err);
		    } else {
			// replace ids of data elements with their attributes
			for (var i=0; i<ins.length; ++i) {
			    ins[i] = data[ins[i]];
			}
			for (var i=0; i<outs.length; ++i) {
			    outs[i] = data[outs[i]];
			}
			cb(null, task, ins, outs);
		    }
		});
            }
        });
    }

    // returns full data element info
    function public_getDataInfo(wfId, dataId, cb) {
	var data, sources, sinks, dataKey, taskKeyPfx, tasks = {};
	var multi = rcl.multi();

	dataKey = "wf:"+wfId+":data:"+dataId;
	taskKeyPfx = "wf:"+wfId+":task:";

	// Retrieve data element info
	multi.hgetall(dataKey, function(err, reply) {
	    if (err) {
		data = err;
	    } else {
		data = reply;
	    }
	});

	// this is a great feature: sort+get combo (even for hashes)!
	multi.sort(dataKey+":sources", "get", taskKeyPfx+"*->uri",
			               "get", taskKeyPfx+"*->name",
			               "get", taskKeyPfx+"*->status",
	function(err, reply) {
	    if (err) {
		sources = err;
	    } else {
		sources = [];
		for (var i=0; i<reply.length; i+=3) {
			sources.push({"uri": reply[i], "name": reply[i+1], "status": reply[i+2]});
		}
		//console.log("sources[0]: "+sources[0]);
	    }
	});

	multi.sort(dataKey+":sinks", "get", taskKeyPfx+"*->uri",
			             "get", taskKeyPfx+"*->name",
			             "get", taskKeyPfx+"*->status",
	function(err, reply) {
	    if (err) {
		sinks = err;
	    } else {
	        sinks = [];	
		for (var i=0; i<reply.length; i+=3) {
			sinks.push({"uri": reply[i], "name": reply[i+1], "status": reply[i+2]});
		}
		//console.log("sinks[0]: "+sinks[0]);
	    }
	});

        multi.exec(function(err, replies) {
            if (err) {
                cb(err);
            } else {
		cb(null, data, sources, sinks);
	    }
	});
    }

    // Returns a 'map' of a workflow. Should be passed a callback:
    // function(nTasks, nData, err, ins, outs, sources, sinks), where:
    // - nTasks        = number of tasks (length of ins and outs arrays)
    // - nData         = number of data elements (length of sources and sinks arrays)
    // - ins[i][j]     = data id mapped to j-th output port of i-th task
    // - outs[i][j]    = data id mapped to j-th input port of i-th task
    // - sources[i][1] = task id which produces data element with id=i (if none, sources[i]=[])
    // - sources[i][2] = port id in this task the data element is mapped to
    // - sinks[i][j]   = task id which consumes data element with id=i (if none, sinks[i]=[])
    // - sinks[i][j+1] = port id in this task the data element is mapped to
    function public_getWfMap(wfId, cb) {
	rcl.zcard("wf:"+wfId+":tasks", function(err, ret) {
	    var nTasks = ret; 
	    rcl.zcard("wf:"+wfId+":data", function(err, ret) {
		var nData = ret;
		var ins = [], outs = [], sources = [], sinks = [], taskKey;
		var multi = rcl.multi();
		for (var i=1; i<=nTasks; ++i) {
		    (function(i) {
			taskKey = "wf:"+wfId+":task:"+i;
			multi.zrangebyscore(taskKey+":ins", 0, "+inf", function(err, ret) { 
			    ins[i] = ret;
			    ins[i].unshift(null); // inputs will be indexed from 1 instead of 0
			});
			multi.zrangebyscore(taskKey+":outs", 0, "+inf", function(err, ret) { 
			    outs[i] = ret;
			    outs[i].unshift(null);
			});
		    })(i);
		}
		for (i=1; i<=nData; ++i) {
		    (function(i) {
			dataKey = "wf:"+wfId+":data:"+i;
			multi.zrangebyscore(dataKey+":sources", 0, "+inf", "withscores", function(err, ret) { 
			    sources[i] = ret;
			    sources[i].unshift(null);
			});
			multi.zrangebyscore(dataKey+":sinks", 0, "+inf", "withscores", function(err, ret) { 
			    if (err) {
				console.log("aaa   "+err);
			    }
			    console.log(i+";"+ret);
			    sinks[i] = ret;
			    sinks[i].unshift(null);
			});
		    })(i);
		}
		multi.exec(function(err, reps) {
		    if (err) {
			console.log(err);
			cb(err);
		    } else {
			cb(null, nTasks, nData, ins, outs, sources, sinks);
		    }
		});
	    });
	});
    }
		

    return {
	getWfInfo: public_getWfInfo,
	getWfInstanceInfo: public_getWfInstanceInfo,
	getWfTasks: public_getWfTasks,
	getTaskInfo: public_getTaskInfo,
	getDataInfo: public_getDataInfo,
	getWfMap: public_getWfMap
    };

    //////////////////////////////////////////////////////////////////////////
    ///////////////////////// private functions //////////////////////////////
    //////////////////////////////////////////////////////////////////////////

    // TODO: rewrite this to use multi instead of async.parallel ?
    function getTasks1(wfId, from, to, dataNum, cb) {
        var tasks = [], ins = [], outs = [], data  = [];
        var asyncTasks = [];
	var start, finish;
	start = (new Date()).getTime();
        for (var i=from; i<=to; ++i) {
            // The following "push" calls need to be wrapped in an anynomous function to create 
            // a separate scope for each value of "i". See http://stackoverflow.com/questions/2568966
            (function(i) {
                var taskKey = "wf:"+wfId+":task:"+i;
                // Retrieve task info
                asyncTasks.push(function(callback) {
                    rcl.hmget(taskKey, "uri", "name", "status", function(err, reply) {
                        if (err) {
                            tasks[i-from] = err;
                            callback(err);
                        } else {
                            tasks[i-from] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
                            callback(null, reply);
                        }
                    });
                });

                // Retrieve all ids of inputs of the task
                asyncTasks.push(function(callback) {
                    rcl.sort(taskKey+":ins", function(err, reply) {
                        if (err) {
                            ins[i-from] = err;
                            callback(err);
                        } else {
		            ins[i-from] = reply;
			    callback(null, reply);
			}
		    });
		});

                // Retrieve all ids of outputs of the task
                asyncTasks.push(function(callback) {
                    rcl.sort(taskKey+":outs", function(err, reply) {
                        if (err) {
                            outs[i-from] = err;
                            callback(err);
                        } else {
		            outs[i-from] = reply;
			    callback(null, reply);
			}
		    });
		});

            })(i);
        }

	// Retrieve info about ALL data elements (of this wf instance). 
	// FIXME: can it be done better (more efficiently)? 
	// - Could be cached in node process's memory but then data may not be fresh.
	// - We could calculate which subset of data elements we need exactly but that
	//   implies additional processing and more complex data structures...
	// - MULTI instead of many parallel tasks?
        for (var i=1; i<=dataNum; ++i) {
            (function(i) {
                var dataKey = "wf:"+wfId+":data:"+i;
                asyncTasks.push(function(callback) {
                    rcl.hmget(dataKey, "uri", "name", "status", function(err, reply) {
                        if (err) {
                            data[i] = err;
                            callback(err);
                        } else {
                            data[i] = {"uri": reply[0], "name": reply[1], "status": reply[2]};
                            callback(null, reply);
                        }
                    });
                });
	    })(i);
	}

	console.log("async tasks: "+asyncTasks.length);

	async.parallel(asyncTasks, function done(err, result) {
            if (err) {
                console.log(err);
                cb(err);
            } else {
	        finish = (new Date()).getTime();
	        console.log("getTasks exec time: "+(finish-start)+"ms");

		// replace ids of data elements with their attributes
		for (var i=0; i<tasks.length; ++i) {
			for (var j=0; j<ins[i].length; ++j) {
				ins[i][j] = data[ins[i][j]];
			}
			for (var k=0; k<outs[i].length; ++k) {
				outs[i][k] = data[outs[i][k]];
			}
		}

                cb(null, tasks, ins, outs);
            }
        });
    }
};
