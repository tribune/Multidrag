/**
 *  Draggable#initialize(element[, options]) -> null
 *  - element (Element): the DOM node that will become draggable
 *  - options (Object): a key/value list of options for the draggable item
 *
 *  This is the standard Script.aculo.us Draggable constructor with
 *  a few extra options not present in the original. The changes
 *  are surrounded by "MULTIDRAG PATCH" comment markers.
 *
 *  In order to use multidrag, Draggable#getSelectedItems() must be present.
 *  This method will vary with the individual implementation, but it should
 *  return an array of the selected items that will be dragged.
 **/
Draggable.prototype.initialize = function (element) {
  var defaults = {
    handle: false,
    reverteffect: function(element, top_offset, left_offset) {
      var dur = Math.sqrt(Math.abs(top_offset^2)+Math.abs(left_offset^2))*0.02;
      new Effect.Move(element, { x: -left_offset, y: -top_offset, duration: dur,
        queue: {scope:'_draggable', position:'end'}
      });
    },
    endeffect: function(element) {
      var toOpacity = Object.isNumber(element._opacity) ? element._opacity : 1.0;
      new Effect.Opacity(element, {duration:0.2, from:0.7, to:toOpacity,
        queue: {scope:'_draggable', position:'end'},
        afterFinish: function(){
          Draggable._dragging[element] = false
        }
      });
    },
    zindex: 1000,
    revert: false,
    quiet: false,
    scroll: false,
    original: false,   // custom
    scrollSensitivity: 20,
    scrollSpeed: 15,
    snap: false,  // false, or xy or [x,y] or function(x,y){ return [x,y] }
    delay: 0
  };

  if(!arguments[1] || Object.isUndefined(arguments[1].endeffect))
    Object.extend(defaults, {
      starteffect: function(element) {
        element._opacity = Element.getOpacity(element);
        Draggable._dragging[element] = true;
        new Effect.Opacity(element, {duration:0.2, from:element._opacity, to:0.7});
      }
    });

  var options = Object.extend(defaults, arguments[1] || { });

  this.element = $(element);

  // ----- MULTIDRAG PATCH -----//
  this.getSelectedItems = options.getSelectedItems;
  // ----- END MULTIDRAG PATCH -----//

  if(options.handle && Object.isString(options.handle))
    this.handle = this.element.down('.'+options.handle, 0);

  if(!this.handle) this.handle = $(options.handle);
  if(!this.handle) this.handle = this.element;

  if(options.scroll && !options.scroll.scrollTo && !options.scroll.outerHTML) {
    options.scroll = $(options.scroll);
    this._isScrollChild = Element.childOf(this.element, options.scroll);
  }

  Element.makePositioned(this.element); // fix IE

  this.options  = options;
  this.dragging = false;

  this.eventMouseDown = this.initDrag.bindAsEventListener(this);
  Event.observe(this.handle, "mousedown", this.eventMouseDown);
  Draggables.register(this);
}


/**
 *  Draggable#startDrag(event) -> null
 *  - event (Event): a native ondrag Event instance
 *
 *  If multidrag is enabled, this method will gather all of the selected items
 *  into a container div and then switch the actively dragging element
 *  to that container. This way we can move multiple items at once without
 *  the overhead of dragging each of them.
 **/
Draggable.prototype.startDrag = function (event) {
  this.dragging = true;
  if(!this.delta)
    this.delta = this.currentDelta();

  if(this.options.zindex) {
    this.originalZ = parseInt(Element.getStyle(this.element,'z-index') || 0);
    this.element.style.zIndex = this.options.zindex;
  }

  if(this.options.ghosting) {
    this._clone = this.element.cloneNode(true);
    this._originallyAbsolute = (this.element.getStyle('position') == 'absolute');
    if (!this._originallyAbsolute)
      Position.absolutize(this.element);
    this.element.parentNode.insertBefore(this._clone, this.element);
  }

  if(this.options.scroll) {
    if (this.options.scroll == window) {
      var where = this._getWindowScroll(this.options.scroll);
      this.originalScrollLeft = where.left;
      this.originalScrollTop = where.top;
    } else {
      this.originalScrollLeft = this.options.scroll.scrollLeft;
      this.originalScrollTop = this.options.scroll.scrollTop;
    }
  }

  // ----- MULTIDRAG PATCH ----- //
  // Create a temporary div around the dragged element.
  // Transfer this.element to that div, so that it is being dragged
  // Move the selected list items into the temporary div
  // Save a reference (draggedElement) to the original dragged list item
  if (this.options.multidrag) {
    var item, i, msg;
    // TODO: change to class name, filter getItems() by that class
    var selectedItems = this.getSelectedItems();

    // If the user has dragged a non-selected item
    if (!selectedItems.include(this.element)) {
      // This will add the item to the end of the array, so the ordering could
      // be incorrect if the item was before the first selected item in the
      // collection. Fixing this was not a priority at the time of this writing.
      selectedItems.push(this.element);
    }

    var siLength = selectedItems.length;
    var container = new Element('div', {'class': 'multiDropmarker'});

    // Set the message (x item[s])
    if (siLength > 0) {
      msg = siLength + ' item' + ((siLength > 1) ? 's' : '');
    } else {
      msg = '1 item';
    }
    container.innerHTML = msg

    this.draggedElement = $(this.element);
    this.element.insert({before: container});

    for (i=0; i < siLength; ++i) {
      item = selectedItems[i];
      container.insert({bottom: item});
      item.hide();
    }

    // this.element refers to the item being dragged. Switch this reference
    // to the container itself.
    this.element = container;
  }
  // ----- END MULTIDRAG PATCH ----- //

  Draggables.notify('onStart', this, event);

  if(this.options.starteffect) this.options.starteffect(this.element);
}


/**
 *  Draggable#finishDrag(event, success) -> null
 *  - event (Event): a native ondrag Event instance
 *  - success (Boolean): true if the element was dropped over a Droppable
 *
 *  When the drag is complete, we need to pull the individual items out of 
 *  the container div and put them back into the list or containing element.
 **/
Draggable.prototype.finishDrag = function (event, success) {
  // ----- MULTIDRAG PATCH ----- //
  // Get all of the elements inside the temporary div
  // insert them before the div
  // remove the temporary div
  // transfer this.element back to the original dragged element (draggedElement)
  if (this.options.multidrag) {
    var item, i;
    var elms = this.element.select('li'); // TODO: replace with some selector
    var elmsLength = elms.length;

    for (i=0; i < elmsLength; ++i) {
      item = elms[i];
      this.element.insert({before: item});
      item.show();
    }

    this.element.remove();
    this.element = this.draggedElement;
  }
  // ----- END MULTIDRAG PATCH ----- //

  this.dragging = false;

  if(this.options.quiet){
    Position.prepare();
    var pointer = [Event.pointerX(event), Event.pointerY(event)];
    Droppables.show(pointer, this.element);
  }

  if(this.options.ghosting) {
    if (!this._originallyAbsolute)
      Position.relativize(this.element);
      // PATCH BEGIN
      // Trigger quasi revert behaviour when Sortable._marker is null:
      // This is a signal we send ourself from onDrop that the draggable should
      // remain on its original position
      if (null == Sortable._marker) {
        this.element.parentNode.insertBefore(this.element, this._clone);
      }
      // PATCH END
    delete this._originallyAbsolute;
    Element.remove(this._clone);
    this._clone = null;
  }

  var dropped = false;
  if(success) {
    dropped = Droppables.fire(event, this.element);
    if (!dropped) dropped = false;
  }
  if(dropped && this.options.onDropped) this.options.onDropped(this.element);
  Draggables.notify('onEnd', this, event);

  var revert = this.options.revert;
  if(revert && Object.isFunction(revert)) revert = revert(this.element);

  var d = this.currentDelta();
  if(revert && this.options.reverteffect) {
    if (dropped == 0 || revert != 'failure')
      this.options.reverteffect(this.element,
        d[1]-this.delta[1], d[0]-this.delta[0]);
  } else {
    this.delta = d;
  }

  if(this.options.zindex)
    this.element.style.zIndex = this.originalZ;

  if(this.options.endeffect)
    this.options.endeffect(this.element);

  Draggables.deactivate(this);
  Droppables.reset();
}


/**
 *  Sortable.create(element[, options]) -> null
 *  - element (Element): the element that will contain the Sortables
 *  - options (Object): key/value list of default options
 *
 *  This is the standard Script.aculo.us Sortable constructor modified to
 *  pass additional options to the Draggable constructor. Changes are 
 *  contained withing "MULTIDRAG PATCH" comments.
 **/
Sortable.create = function (element) {
  element = $(element);
  var options = Object.extend({
    element:     element,
    tag:         'li',       // assumes li children, override with tag: 'tagname'
    dropOnEmpty: false,
    tree:        false,
    treeTag:     'ul',
    overlap:     'vertical', // one of 'vertical', 'horizontal'
    constraint:  'vertical', // one of 'vertical', 'horizontal', false
    containment: element,    // also takes array of elements (or id's); or false
    handle:      false,      // or a CSS class
    only:        false,
    delay:       0,
    hoverclass:  null,
    ghosting:    false,
    quiet:       false,
    scroll:      false,
    scrollSensitivity: 20,
    scrollSpeed: 15,
    format:      this.SERIALIZE_RULE,

    // ----- MULTIDRAG PATCH ----- //
    multidrag:   false,
    getSelectedItems: Prototype.emptyFunction,
    // ----- END MULTIDRAG PATCH ----- //

    // these take arrays of elements or ids and can be
    // used for better initialization performance
    elements:    false,
    handles:     false,

    onChange:    Prototype.emptyFunction,
    onUpdate:    Prototype.emptyFunction
  }, arguments[1] || { });

  // clear any old sortable with same element
  this.destroy(element);

  // build options for the draggables
  var options_for_draggable = {
    revert:      true,
    quiet:       options.quiet,
    scroll:      options.scroll,
    scrollSpeed: options.scrollSpeed,
    scrollSensitivity: options.scrollSensitivity,
    delay:       options.delay,
    ghosting:    options.ghosting,
    constraint:  options.constraint,

    //handle:      options.handle};
    // ----- MULTIDRAG PATCH ----- //
    handle:      options.handle,
    multidrag:   options.multidrag,
    getSelectedItems: options.getSelectedItems};
    // ----- END MULTIDRAG PATCH ----- //

  if(options.starteffect)
    options_for_draggable.starteffect = options.starteffect;

  if(options.reverteffect)
    options_for_draggable.reverteffect = options.reverteffect;
  else
    if(options.ghosting) options_for_draggable.reverteffect = function(element) {
      element.style.top  = 0;
      element.style.left = 0;
    };

  if(options.endeffect)
    options_for_draggable.endeffect = options.endeffect;

  if(options.zindex)
    options_for_draggable.zindex = options.zindex;

  // build options for the droppables
  var options_for_droppable = {
    overlap:     options.overlap,
    containment: options.containment,
    tree:        options.tree,
    hoverclass:  options.hoverclass,
    onHover:     Sortable.onHover
  };

  var options_for_tree = {
    onHover:      Sortable.onEmptyHover,
    overlap:      options.overlap,
    containment:  options.containment,
    hoverclass:   options.hoverclass
  };

  // fix for gecko engine
  Element.cleanWhitespace(element);

  options.draggables = [];
  options.droppables = [];

  // drop on empty handling
  if(options.dropOnEmpty || options.tree) {
    Droppables.add(element, options_for_tree);
    options.droppables.push(element);
  }

  (options.elements || this.findElements(element, options) || []).each( function(e,i) {
    var handle = options.handles ? $(options.handles[i]) :
      (options.handle ? $(e).select('.' + options.handle)[0] : e);
    options.draggables.push(
      new Draggable(e, Object.extend(options_for_draggable, { handle: handle })));
    Droppables.add(e, options_for_droppable);
    if(options.tree) e.treeNode = element;
    options.droppables.push(e);
  });

  if(options.tree) {
    (Sortable.findTreeElements(element, options) || []).each( function(e) {
      Droppables.add(e, options_for_tree);
      e.treeNode = element;
      options.droppables.push(e);
    });
  }

  // keep reference
  this.sortables[element.id] = options;

  // for onupdate
  Draggables.addObserver(new SortableObserver(element, options.onUpdate));

}

