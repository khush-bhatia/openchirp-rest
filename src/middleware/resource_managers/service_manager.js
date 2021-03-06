var Device = require('../../models/device');
var DeviceTemplate = require('../../models/device_template');
var Service = require('../../models/service');
var async = require('async');
var service_pubsub = require('../pubsub/service_pubsub');
var thingTokenManager = require('./thing_token_manager');
const serviceAuthorizer = require('../accesscontrol/service_authorizer');

exports.getAllServices = function(callback){
	Service.find().populate('owner', 'name email').exec(callback);
};

exports.createNewService = function(req, callback){
	var service = new Service(req.body);
    service.owner = req.user._id;
    service.save(function (err, result) {
        if(err) { return callback(err); }
        result.populate('owner', 'name email').populate(callback);
    });
};

exports.getById = function(id, callback){
	Service.findById(id).populate('owner', 'name email').exec(function (err, result) {
        if(err) { return callback(err) ; }
        if (result == null ) {
            var error = new Error();
            error.message = 'Could not find a service with id :'+ id ;
            return callback(error);
        }
        return callback(null, result);
    })
};

exports.updateService = function(req, callback){

    var updateProps = false;
    var serviceToUpdate = req.service;
    if(typeof req.body.name != 'undefined') serviceToUpdate.name = req.body.name;
    if(typeof req.body.description != 'undefined') serviceToUpdate.description = req.body.description;
    if(typeof req.body.config_required != 'undefined') serviceToUpdate.config_required = req.body.config_required;
    if(typeof req.body.device_permission != 'undefined') serviceToUpdate.device_permission= req.body.device_permission;
    if(typeof req.body.properties != 'undefined') {
        updateProps = true;
        serviceToUpdate.properties = req.body.properties;
    }
    serviceToUpdate.save(function(err, result){
         if(err) { return callback(err); }
         if(updateProps){
            service_pubsub.publishUpdateProperties(req.service, serviceToUpdate.properties , callback);
         }else{
            return callback(null, result);
         }
    });
};
exports.updateStatus = function(serviceId, newStatus, callback){
    Service.findByIdAndUpdate(serviceId, {$set: {status: newStatus}}, callback);
}
exports.postDeleteCleanup = function(serviceId, callback){
    async.parallel([
            function(next){
                Device.update({"linked_services.service_id" : serviceId }, { $pull: { linked_services: { service_id : serviceId }}}, { multi: true}, next);
            },
            function(next){
                DeviceTemplate.update({"linked_services.service_id" : serviceId }, { $pull: { linked_services: { service_id : serviceId }}}, { multi: true}, next);
            },
            function(next){
                thingTokenManager.deleteTokenByThingId(serviceId, next);
            }
    ],
    function(err, results){
        if(err) {
         // Best Effort cleanup. Ignore errors
          console.log(err);
        }
        return callback(null, null);
    })

}

exports.deleteService = function(req, callback){
    var serviceToDelete = req.service;
    serviceToDelete.remove(function(err, result){
        if(err) { return callback(err); }
        exports.postDeleteCleanup(serviceToDelete._id, callback);
    });

};

exports.getServicesByOwner = function(req, callback) {
    var userId = req.user._id;
    if(req.query && req.query.name ){
        var name = req.query.name;
    }
    if(name){
        Service.find({"owner" : userId , $text: { $search: name }}).exec(callback);
    }else{
        Service.find({"owner" : userId}).exec(callback);
    }
};

exports.getThings = function(req, callback){
    var serviceId = req.service._id;
    var things = [];
    let isAuthorized = serviceAuthorizer.isAuthorized(req);
    Device.find({"linked_services.service_id" : serviceId }, {"linked_services.$" : 1 }).
        populate('owner', 'name email').
        select('owner pubsub name linked_services.config').
        exec(function(err, result){
        if(err) { return callback(err); }
        for (var i = 0; i < result.length; i++) {
           var thing = {};
           thing.id = result[i]._id;
           thing.name = result[i].name;
           thing.owner = {};
           thing.owner.name = result[i].owner.name;
           thing.owner.email = result[i].owner.email;
           thing.pubsub = {};
           thing.pubsub.protocol = result[i].pubsub.protocol;
           thing.pubsub.endpoint = result[i].pubsub.endpoint;
           thing.config = [];
           if (isAuthorized || result[i].owner.id == req.user.id) {
               // The search query ensures that only 1 object is returned in linked_services.
               thing.config = result[i].linked_services[0].config;
           }
           things.push(thing);
         }

         return callback(null, things);
     })
};

/**
 * Returns more detailed device information than getThings
 */
exports.getDeviceInfo = function(req, callback){
    var serviceId = req.service._id;
    var devices = [];
    let isAuthorized = serviceAuthorizer.isAuthorized(req);
    Device.find({'linked_services.service_id' : serviceId }, {'linked_services.$' : 1, 'owner' : 1, 'location_id': 1 }).
        populate('owner location_id').
        select('owner location_id pubsub name linked_services').
        exec(function(err, result){
        if(err) { return callback(err); }
        for (var i = 0; i < result.length; i++) {
            var device = {};
            device.id = result[i]._id;
            device.name = result[i].name;
            device.owner = {};
            device.owner.name = result[i].owner.name;
            device.owner.email = result[i].owner.email;
            device.location = {};
            device.location.name = (result[i].location_id) ? result[i].location_id.name : '-';
            device.pubsub = {};
            device.pubsub.protocol = result[i].pubsub.protocol;
            device.pubsub.endpoint = result[i].pubsub.endpoint;
            device.config = [];
            if (isAuthorized || result[i].owner.id == req.user.id) {
               // The search query ensures that only 1 object is returned in linked_services.
               device.config = result[i].linked_services[0].config;
            }
            device.status = {};
            device.status.message = result[i].linked_services[0].status.message;
            devices.push(device);
        }

        return callback(null, devices);
    })
};


module.exports = exports;